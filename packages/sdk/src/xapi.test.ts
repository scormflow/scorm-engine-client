import { describe, expect, it, vi } from 'vitest';

import { XapiClient, XAPI_VERSION } from './xapi.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://x/v1';
const AGENT = { mbox: 'mailto:ada@example.com' };
const ACTIVITY = 'http://example.com/courses/intro';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function emptyResponse(status = 204, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

function client(fetchMock: FetchLike): XapiClient {
  return new XapiClient({ baseUrl: BASE, apiKey: 'k', fetch: fetchMock, retries: 0 });
}

/** The parsed query of the Nth fetch call. */
function queryOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): URLSearchParams {
  return new URL(fetchMock.mock.calls[call]![0] as string).searchParams;
}

function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]![1] as RequestInit).headers as Record<string, string>;
}

describe('about', () => {
  it('fetches the About document without a version header', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ version: ['1.0.3'] }));
    const res = await client(fetchMock).about();

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/xapi/about`);
    expect(headersOf(fetchMock)['X-Experience-API-Version']).toBeUndefined();
    expect(res.version).toEqual(['1.0.3']);
  });
});

describe('statements', () => {
  it('sends the version header on every statement call', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(['id-1']));
    await client(fetchMock).storeStatements({
      actor: AGENT,
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: { id: ACTIVITY },
    });

    expect(headersOf(fetchMock)['X-Experience-API-Version']).toBe(XAPI_VERSION);
  });

  it('stores a batch and returns the ids', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(['id-1', 'id-2']));
    const statement = {
      actor: AGENT,
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: { id: ACTIVITY },
    };

    const ids = await client(fetchMock).storeStatements([statement, statement]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/xapi/statements`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toHaveLength(2);
    expect(ids).toEqual(['id-1', 'id-2']);
  });

  it('puts a statement under a chosen id', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse());
    await client(fetchMock).putStatement('abc', {
      actor: AGENT,
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: { id: ACTIVITY },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(new URL(url).searchParams.get('statementId')).toBe('abc');
  });

  it('encodes query filters the way the LRS expects', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ statements: [], more: '' }));
    await client(fetchMock).queryStatements({
      agent: AGENT,
      verb: 'http://adlnet.gov/expapi/verbs/completed',
      activity: ACTIVITY,
      relatedActivities: true,
      since: new Date('2026-01-01T00:00:00.000Z'),
      limit: 10,
      format: 'ids',
    });

    const q = queryOf(fetchMock);
    expect(JSON.parse(q.get('agent')!)).toEqual(AGENT);
    expect(q.get('activity')).toBe(ACTIVITY);
    expect(q.get('related_activities')).toBe('true');
    expect(q.get('since')).toBe('2026-01-01T00:00:00.000Z');
    expect(q.get('limit')).toBe('10');
    expect(q.get('format')).toBe('ids');
  });

  it('returns null for a statement the LRS does not have', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ code: 'statement_not_found', message: 'nope' }, 404),
    );
    expect(await client(fetchMock).getStatement('missing')).toBeNull();
  });

  it('asks for a voided statement by the right parameter', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'v1' }));
    await client(fetchMock).getStatement('v1', { voided: true });

    expect(queryOf(fetchMock).get('voidedStatementId')).toBe('v1');
    expect(queryOf(fetchMock).get('statementId')).toBeNull();
  });

  it('follows a more link against the engine origin rather than rebuilding it', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ statements: [], more: '' }));
    await client(fetchMock).moreStatements('/v1/xapi/statements?cursor=50&limit=10');

    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/xapi/statements?cursor=50&limit=10');
  });

  it('treats an empty more link as the end of the results', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ statements: [], more: '' }));
    const page = await client(fetchMock).moreStatements('');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(page).toEqual({ statements: [], more: '' });
  });

  it('iterates every page', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ statements: [{ id: 'a' }], more: '/v1/xapi/statements?cursor=1' }))
      .mockResolvedValueOnce(jsonResponse({ statements: [{ id: 'b' }], more: '' }));

    const pages: string[] = [];
    for await (const page of client(fetchMock).iterateStatements()) {
      pages.push(...page.map((s) => s.id as string));
    }

    expect(pages).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops iterating at maxPages even when more links continue', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ statements: [{ id: 'a' }], more: '/v1/xapi/statements?cursor=1' }),
    );

    let pages = 0;
    for await (const _page of client(fetchMock).iterateStatements({}, { maxPages: 3 })) {
      pages += 1;
    }

    expect(pages).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('state documents', () => {
  const key = { activityId: ACTIVITY, agent: AGENT, stateId: 'bookmark' };

  it('reads a document with its etag', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ page: 2 }, 200, { etag: '"abc"', 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT' }),
    );
    const doc = await client(fetchMock).state.get<{ page: number }>(key);

    const q = queryOf(fetchMock);
    expect(q.get('activityId')).toBe(ACTIVITY);
    expect(JSON.parse(q.get('agent')!)).toEqual(AGENT);
    expect(q.get('stateId')).toBe('bookmark');
    expect(doc?.content).toEqual({ page: 2 });
    expect(doc?.etag).toBe('"abc"');
    expect(doc?.lastModified).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  it('returns null when the document does not exist yet', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'state_not_found' }, 404));
    expect(await client(fetchMock).state.get(key)).toBeNull();
  });

  it('includes the registration when one is given', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({}));
    await client(fetchMock).state.get({ ...key, registration: 'reg-1' });

    expect(queryOf(fetchMock).get('registration')).toBe('reg-1');
  });

  it('writes JSON and hands back the new etag', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse(204, { etag: '"new"' }));
    const res = await client(fetchMock).state.put(key, { page: 3 });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"page":3}');
    expect(headersOf(fetchMock)['content-type']).toBe('application/json');
    expect(res.etag).toBe('"new"');
  });

  it('writes a string as text/plain', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse());
    await client(fetchMock).state.put(key, 'just text');

    expect(fetchMock.mock.calls[0]![1].body).toBe('just text');
    expect(headersOf(fetchMock)['content-type']).toBe('text/plain');
  });

  it('passes conditional headers through', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse());
    await client(fetchMock).state.put(key, { page: 3 }, { ifMatch: '"abc"' });
    await client(fetchMock).state.put(key, { page: 3 }, { ifNoneMatch: '*' });

    expect(headersOf(fetchMock, 0)['if-match']).toBe('"abc"');
    expect(headersOf(fetchMock, 1)['if-none-match']).toBe('*');
  });

  it('merges with POST', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse());
    await client(fetchMock).state.post(key, { page: 3 });

    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });

  it('lists state ids for a scope, without a stateId', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(['bookmark', 'prefs']));
    const ids = await client(fetchMock).state.list(
      { activityId: ACTIVITY, agent: AGENT },
      { since: new Date('2026-01-01T00:00:00.000Z') },
    );

    const q = queryOf(fetchMock);
    expect(q.get('stateId')).toBeNull();
    expect(q.get('since')).toBe('2026-01-01T00:00:00.000Z');
    expect(ids).toEqual(['bookmark', 'prefs']);
  });

  it('deletes a document', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse());
    await client(fetchMock).state.delete(key);

    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
    expect(queryOf(fetchMock).get('stateId')).toBe('bookmark');
  });
});

describe('profile documents', () => {
  it('reads an activity profile', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ theme: 'dark' }, 200, { etag: '"p"' }));
    const doc = await client(fetchMock).activityProfile.get({
      activityId: ACTIVITY,
      profileId: 'prefs',
    });

    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe('/v1/xapi/activities/profile');
    const q = queryOf(fetchMock);
    expect(q.get('activityId')).toBe(ACTIVITY);
    expect(q.get('profileId')).toBe('prefs');
    expect(doc?.content).toEqual({ theme: 'dark' });
  });

  it('reads an agent profile, encoding the agent as JSON', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ locale: 'en-GB' }));
    await client(fetchMock).agentProfile.get({ agent: AGENT, profileId: 'prefs' });

    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe('/v1/xapi/agents/profile');
    expect(JSON.parse(queryOf(fetchMock).get('agent')!)).toEqual(AGENT);
  });

  it('lists profile ids per owner', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(['prefs']));
    await client(fetchMock).agentProfile.list({ agent: AGENT });

    expect(queryOf(fetchMock).get('profileId')).toBeNull();
  });

  it('writes and deletes an activity profile', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => emptyResponse(204, { etag: '"z"' }));
    const api = client(fetchMock).activityProfile;

    const written = await api.put({ activityId: ACTIVITY, profileId: 'prefs' }, { theme: 'dark' });
    expect(written.etag).toBe('"z"');

    await api.delete({ activityId: ACTIVITY, profileId: 'prefs' }, { ifMatch: '"z"' });
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
    expect(headersOf(fetchMock, 1)['if-match']).toBe('"z"');
  });

  it('returns null for a profile that was never written', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'profile_not_found' }, 404));
    expect(
      await client(fetchMock).activityProfile.get({ activityId: ACTIVITY, profileId: 'nope' }),
    ).toBeNull();
  });
});

describe('activity and person lookups', () => {
  it('fetches an activity', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ objectType: 'Activity', id: ACTIVITY, definition: { name: { 'en-US': 'Intro' } } }),
    );
    const activity = await client(fetchMock).getActivity(ACTIVITY);

    expect(new URL(fetchMock.mock.calls[0]![0] as string).pathname).toBe('/v1/xapi/activities');
    expect(activity?.definition).toEqual({ name: { 'en-US': 'Intro' } });
  });

  it('returns null for an activity the LRS has never seen', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'activity_not_found' }, 404));
    expect(await client(fetchMock).getActivity(ACTIVITY)).toBeNull();
  });

  it('fetches a person', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ objectType: 'Person', name: ['Ada'], mbox: ['mailto:ada@example.com'] }),
    );
    const person = await client(fetchMock).getPerson(AGENT);

    expect(JSON.parse(queryOf(fetchMock).get('agent')!)).toEqual(AGENT);
    expect(person.name).toEqual(['Ada']);
  });
});

describe('non-JSON documents', () => {
  it('hands back text untouched', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () => new Response('plain note', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const doc = await client(fetchMock).state.get({
      activityId: ACTIVITY,
      agent: AGENT,
      stateId: 'notes',
    });

    expect(doc?.content).toBe('plain note');
    expect(doc?.contentType).toContain('text/plain');
  });

  it('falls back to raw text when a JSON document will not parse', async () => {
    const fetchMock = vi.fn<FetchLike>(
      async () => new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const doc = await client(fetchMock).state.get({
      activityId: ACTIVITY,
      agent: AGENT,
      stateId: 'broken',
    });

    expect(doc?.content).toBe('{broken');
  });
});
