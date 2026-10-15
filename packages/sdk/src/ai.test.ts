import { describe, expect, it, vi } from 'vitest';

import { AiClient, isAiUnavailable, type AiInsight, type AiProviderConfig } from './ai.js';
import { ScormClient } from './client.js';
import { ScormHttpError } from './errors.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://engine.test/api/v1';

const CONFIG: AiProviderConfig = {
  feature: 'default',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  baseUrl: null,
  hasKey: true,
  keyHint: '…9876',
  redactPii: true,
  enabled: true,
  monthlyTokenCap: 100_000,
  alertThreshold: 0.8,
  inputCostPerMTok: null,
  outputCostPerMTok: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const INSIGHT: AiInsight = {
  id: 'call_1',
  kind: 'insights',
  scope: 'course',
  courseId: 'course_1',
  feature: 'default',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  text: '- Completion dropped after slide 8.',
  usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500, costUsd: null },
  redactions: { count: 1, counts: { email: 1 } },
  sample: { attempts: 42, truncated: false, from: null, to: null },
  generatedAt: '2026-10-15T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(respond: (url: string, init: RequestInit) => Response, retries = 2) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = new AiClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries, retryBaseMs: 1 });
  return { client, calls };
}

const body = (init: RequestInit) => JSON.parse(init.body as string);

describe('AiClient', () => {
  it('lists and reads provider configs', async () => {
    const { client, calls } = setup((url) => jsonResponse(url.endsWith('/providers') ? { data: [CONFIG] } : CONFIG));
    expect(await client.providers()).toEqual([CONFIG]);
    expect(calls[0]!.url).toBe(`${BASE}/ai/providers`);
    expect((calls[0]!.init.headers as Record<string, string>)['X-API-Key']).toBe('sk_test');
    expect(await client.provider('summary')).toEqual(CONFIG);
    expect(calls[1]!.url).toBe(`${BASE}/ai/providers/summary`);
  });

  it('sets a provider with PUT and reports whether it was created', async () => {
    let status = 201;
    const { client, calls } = setup(() => jsonResponse(CONFIG, status));
    const input = { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-x', monthlyTokenCap: 100_000 } as const;
    expect(await client.setProvider('default', input)).toEqual({ config: CONFIG, created: true });
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toBe(`${BASE}/ai/providers/default`);
    expect(body(calls[0]!.init)).toEqual(input);
    status = 200;
    expect((await client.setProvider('default', { provider: 'anthropic', model: 'x' })).created).toBe(false);
  });

  it('deletes a provider', async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));
    await client.deleteProvider('insights');
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe(`${BASE}/ai/providers/insights`);
  });

  it('tests a key without retrying', async () => {
    const { client, calls } = setup(() =>
      jsonResponse({ ok: false, provider: 'openai', model: 'm', latencyMs: 12, error: { code: 'ai_provider_auth', message: 'no' } }),
    );
    const result = await client.testProvider({ provider: 'openai', model: 'm', apiKey: 'bad' });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ai_provider_auth');
    expect(calls[0]!.url).toBe(`${BASE}/ai/providers/test`);
    expect(body(calls[0]!.init)).toEqual({ provider: 'openai', model: 'm', apiKey: 'bad' });
  });

  it('generates an insight', async () => {
    const { client, calls } = setup(() => jsonResponse(INSIGHT));
    expect(await client.generate({ kind: 'insights', courseId: 'course_1', question: 'Why?' })).toEqual(INSIGHT);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/ai/insights`);
    expect(body(calls[0]!.init)).toEqual({ kind: 'insights', courseId: 'course_1', question: 'Why?' });
  });

  it('never retries generate — a retry would spend tokens twice', async () => {
    const { client, calls } = setup(
      () => jsonResponse({ code: 'ai_provider_error', message: 'anthropic answered HTTP 529' }, 502),
      3,
    );
    const err = await client.generate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect((err as ScormHttpError).code).toBe('ai_provider_error');
    expect(calls).toHaveLength(1);

    const budget = setup(() => jsonResponse({ code: 'ai_budget_exceeded', message: 'cap' }, 429), 3);
    const err2 = await budget.client.generate().catch((e: unknown) => e);
    expect((err2 as ScormHttpError).code).toBe('ai_budget_exceeded');
    expect(budget.calls).toHaveLength(1);
  });

  it('reads usage and the call log, as JSON and CSV', async () => {
    const { client, calls } = setup((url) => {
      if (url.includes('format=csv')) return new Response('id,createdAt\ncall_1,2026-10-15\n', { status: 200 });
      if (url.includes('/usage')) return jsonResponse({ month: '2026-10', data: [] });
      return jsonResponse({ data: [], pagination: { nextCursor: null, hasMore: false } });
    });
    expect(await client.usage()).toEqual({ month: '2026-10', data: [] });
    expect(calls[0]!.url).toBe(`${BASE}/ai/usage`);
    await client.calls({ limit: 10, before: '2026-10-15T00:00:00.000Z' });
    expect(calls[1]!.url).toBe(`${BASE}/ai/calls?limit=10&before=2026-10-15T00%3A00%3A00.000Z`);
    await client.calls();
    expect(calls[2]!.url).toBe(`${BASE}/ai/calls`);
    expect(await client.callsCsv({ limit: 5 })).toBe('id,createdAt\ncall_1,2026-10-15\n');
    expect(calls[3]!.url).toBe(`${BASE}/ai/calls?format=csv&limit=5`);
  });

  it('tells "AI is off on this engine" apart from "not configured yet"', () => {
    const routeMissing = new ScormHttpError(404, { code: 'not_found', message: 'Route not found' }, '');
    const notConfigured = new ScormHttpError(404, { code: 'ai_not_configured', message: '' }, '');
    expect(isAiUnavailable(routeMissing)).toBe(true);
    expect(isAiUnavailable(notConfigured)).toBe(false);
    expect(isAiUnavailable(new Error('x'))).toBe(false);
  });

  it('is exposed on ScormClient as client.ai', () => {
    const client = new ScormClient({ baseUrl: BASE, apiKey: 'sk', fetch: vi.fn<FetchLike>() });
    expect(client.ai).toBeInstanceOf(AiClient);
    expect(client.ai.http).toBe(client.http);
  });
});
