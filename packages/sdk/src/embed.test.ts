import { describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import { EmbedClient } from './embed.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://engine.test/api/v1';
const TOKEN = { token: 'eyJ.attempt.jwt', expiresAt: '2026-10-19T11:00:00.000Z' };

function setup() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(TOKEN), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const embed = new EmbedClient({ baseUrl: `${BASE}/`, apiKey: 'sk_test', fetch, retries: 0 });
  return { embed, calls };
}

describe('EmbedClient', () => {
  it('mints an attempt token with the API key', async () => {
    const { embed, calls } = setup();
    await expect(embed.token('att 1', { ttlSeconds: 600 })).resolves.toEqual(TOKEN);
    expect(calls[0]!.url).toBe(`${BASE}/auth/attempt-token`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ attemptId: 'att 1', ttlSeconds: 600 });
    expect(new Headers(calls[0]!.init.headers).get('x-api-key')).toBe('sk_test');
  });

  it('builds player page URLs, with replay capture only when asked', () => {
    const { embed, calls } = setup();
    expect(embed.playUrl('att/1', 'tok')).toBe(`${BASE}/play/att%2F1?token=tok`);
    expect(
      embed.playUrl('att_1', 'tok', {
        theme: 'dark',
        source: 'external',
        src: 'https://cdn.test/sco/index.html?x=1&y=2',
        replay: true,
        pointer: true,
      }),
    ).toBe(
      `${BASE}/play/att_1?token=tok&theme=dark&source=external&src=https%3A%2F%2Fcdn.test%2Fsco%2Findex.html%3Fx%3D1%26y%3D2&replay=1&pointer=1`,
    );
    // pointer without replay means nothing.
    expect(embed.playUrl('att_1', 'tok', { pointer: true })).toBe(`${BASE}/play/att_1?token=tok`);
    expect(calls).toHaveLength(0);
  });

  it('builds bare and hydrated runtime script URLs', () => {
    const { embed } = setup();
    expect(embed.runtimeScriptUrl()).toBe(`${BASE}/runtime.js`);
    expect(embed.runtimeScriptUrl({ attemptId: 'att_1', token: 'tok', replay: true })).toBe(
      `${BASE}/runtime.js?attemptId=att_1&token=tok&replay=1`,
    );
  });

  it('launches: mints a token and returns the player URL', async () => {
    const { embed, calls } = setup();
    const launch = await embed.launch('att_1', { ttlSeconds: 900, replay: true });
    expect(launch).toEqual({ ...TOKEN, url: `${BASE}/play/att_1?token=eyJ.attempt.jwt&replay=1` });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ attemptId: 'att_1', ttlSeconds: 900 });
  });

  it('is exposed on the facade, sharing its HTTP client', () => {
    const client = new ScormClient({ baseUrl: BASE, apiKey: 'sk_test', fetch: vi.fn<FetchLike>() });
    expect(client.embed).toBeInstanceOf(EmbedClient);
    expect(client.embed.http).toBe(client.http);
  });
});
