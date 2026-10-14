import { describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import { ScormHttpError } from './errors.js';
import type { FetchLike } from './http/http-client.js';
import { isPluginMissing, PluginsClient, type ActivityReport } from './plugins.js';

const BASE = 'https://engine.test/api/v1';

const REPORT: ActivityReport = {
  windowMinutes: 2,
  since: '2026-10-14T10:00:00.000Z',
  total: 3,
  totals: { 'attempt.started': 2, 'course.completed': 1 },
  timeline: [
    { minute: '2026-10-14T10:00:00.000Z', total: 2, counts: { 'attempt.started': 2 } },
    { minute: '2026-10-14T10:01:00.000Z', total: 1, counts: { 'course.completed': 1 } },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = new PluginsClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries: 0 });
  return { client, calls };
}

describe('PluginsClient', () => {
  it('lists installed plugins and answers has()', async () => {
    const { client, calls } = setup(() =>
      jsonResponse({ data: [{ name: 'analytics', version: '1.0.0' }, { name: 'slack', version: null }] }),
    );
    expect(await client.list()).toEqual([
      { name: 'analytics', version: '1.0.0' },
      { name: 'slack', version: null },
    ]);
    expect(calls[0]!.url).toBe(`${BASE}/plugins`);
    expect((calls[0]!.init.headers as Record<string, string>)['X-API-Key']).toBe('sk_test');
    expect(await client.has('slack')).toBe(true);
    expect(await client.has('nope')).toBe(false);
  });

  it('reads live activity, with and without a window', async () => {
    const { client, calls } = setup(() => jsonResponse(REPORT));
    expect(await client.activity({ minutes: 2 })).toEqual(REPORT);
    expect(calls[0]!.url).toBe(`${BASE}/plugins/analytics/activity?minutes=2`);
    await client.activity();
    expect(calls[1]!.url).toBe(`${BASE}/plugins/analytics/activity`);
  });

  it('rejects with a 404 that isPluginMissing recognises when analytics is not installed', async () => {
    const { client } = setup(() => jsonResponse({ code: 'not_found', message: 'Route not found' }, 404));
    const err = await client.activity().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect(isPluginMissing(err)).toBe(true);
    expect(isPluginMissing(new Error('x'))).toBe(false);
  });

  it("calls any plugin's own routes", async () => {
    const { client, calls } = setup((url) => jsonResponse({ url }));
    await client.get('slack', '/status', { query: { verbose: true } });
    expect(calls[0]!.url).toBe(`${BASE}/plugins/slack/status?verbose=true`);
    await client.post('slack', 'channels/test', { channel: '#x' });
    expect(calls[1]!.url).toBe(`${BASE}/plugins/slack/channels/test`);
    expect(calls[1]!.init.method).toBe('POST');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ channel: '#x' });
    await client.get('my plugin', '');
    expect(calls[2]!.url).toBe(`${BASE}/plugins/my%20plugin`);
  });

  it('is exposed on ScormClient as client.plugins', () => {
    const client = new ScormClient({ baseUrl: BASE, apiKey: 'sk', fetch: vi.fn<FetchLike>() });
    expect(client.plugins).toBeInstanceOf(PluginsClient);
    expect(client.plugins.http).toBe(client.http);
  });
});
