import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import type { FetchLike } from './http/http-client.js';
import {
  constructWebhookEvent,
  verifyWebhookSignature,
  WebhooksClient,
  WebhookSignatureError,
  type XapiStatementStoredEventData,
} from './webhooks.js';

const SECRET = 'whsec_test';
const BODY = JSON.stringify({ id: 'evt_1', type: 'course.completed', createdAt: '2026-10-05T12:00:00Z', data: {} });
const NOW = new Date('2026-10-05T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);

/** What the engine sends — computed with node:crypto, independently of the SDK. */
const engineSignature = (secret = SECRET, body = BODY, t = T) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('verifyWebhookSignature', () => {
  it('accepts the signature the engine computes', async () => {
    expect(await verifyWebhookSignature(SECRET, engineSignature(), BODY, { now: NOW })).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, a stale timestamp, and a missing header', async () => {
    expect(await verifyWebhookSignature(SECRET, engineSignature(), `${BODY} `, { now: NOW })).toBe(false);
    expect(await verifyWebhookSignature('whsec_other', engineSignature(), BODY, { now: NOW })).toBe(false);
    expect(await verifyWebhookSignature(SECRET, engineSignature(SECRET, BODY, T - 301), BODY, { now: NOW })).toBe(false);
    expect(await verifyWebhookSignature(SECRET, null, BODY, { now: NOW })).toBe(false);
  });

  it('accepts any v1 in the header, for rotation', async () => {
    const old = engineSignature('whsec_old').split(',')[1];
    const header = `${engineSignature()},${old}`;
    expect(await verifyWebhookSignature(SECRET, header, BODY, { now: NOW })).toBe(true);
  });
});

describe('constructWebhookEvent', () => {
  it('returns the parsed payload when the signature checks out', async () => {
    const event = await constructWebhookEvent(BODY, engineSignature(), SECRET, { now: NOW });
    expect(event).toMatchObject({ id: 'evt_1', type: 'course.completed' });
  });

  it('types the payload of an xapi.statement.stored event', async () => {
    const body = JSON.stringify({
      id: 'evt_2',
      type: 'xapi.statement.stored',
      createdAt: '2026-10-05T12:00:00Z',
      data: {
        statementId: 's-1',
        verbId: 'http://adlnet.gov/expapi/verbs/completed',
        actor: 'mbox:mailto:ada@example.com',
        objectType: 'Activity',
        objectId: 'http://example.com/courses/intro',
        registration: null,
        voidsStatementId: null,
        statement: { id: 's-1' },
      },
    });
    const event = await constructWebhookEvent<XapiStatementStoredEventData>(
      body,
      engineSignature(SECRET, body),
      SECRET,
      { now: NOW },
    );
    expect(event.type).toBe('xapi.statement.stored');
    expect(event.data.statement.id).toBe('s-1');
  });

  it('throws WebhookSignatureError otherwise', async () => {
    await expect(constructWebhookEvent(BODY, 't=1,v1=00', SECRET, { now: NOW })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });
});

describe('WebhooksClient', () => {
  it('hits the /webhooks REST surface', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ data: [] }));
    const client = new WebhooksClient({ baseUrl: 'https://e/api/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });

    await client.list();
    await client.create({ url: 'https://hooks.example.com', events: ['*'] });
    await client.update('w1', { enabled: false });
    await client.rotateSecret('w1');
    await client.sendTest('w1');
    await client.listDeliveries('w1', { status: 'FAILED', limit: 10 });
    await client.retryDelivery('d1');
    await client.eventTypes();

    expect(fetchMock.mock.calls.map((c) => [c[1].method, c[0]])).toEqual([
      ['GET', 'https://e/api/v1/webhooks'],
      ['POST', 'https://e/api/v1/webhooks'],
      ['PATCH', 'https://e/api/v1/webhooks/w1'],
      ['POST', 'https://e/api/v1/webhooks/w1/rotate-secret'],
      ['POST', 'https://e/api/v1/webhooks/w1/test'],
      ['GET', 'https://e/api/v1/webhooks/w1/deliveries?status=FAILED&limit=10'],
      ['POST', 'https://e/api/v1/webhooks/deliveries/d1/retry'],
      ['GET', 'https://e/api/v1/webhooks/event-types'],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string)).toEqual({ enabled: false });
  });

  it('never retries create, test or redelivery', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'boom' }, 503));
    const client = new WebhooksClient({ baseUrl: 'https://e/api/v1', fetch: fetchMock, retries: 3, retryBaseMs: 0 });
    await expect(client.create({ url: 'https://x', events: ['*'] })).rejects.toThrow();
    await expect(client.sendTest('w1')).rejects.toThrow();
    await expect(client.retryDelivery('d1')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('is exposed on the ScormClient facade', () => {
    const client = new ScormClient({ baseUrl: 'https://e/api/v1' });
    expect(client.webhooks).toBeInstanceOf(WebhooksClient);
    expect(client.webhooks.http).toBe(client.http);
  });
});
