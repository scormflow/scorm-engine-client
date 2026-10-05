import { describe, expect, it, vi } from 'vitest';

import {
  CMI5_CATEGORY,
  CMI5_SESSION_EXTENSION,
  CMI5_VERBS,
  Cmi5AuSession,
  Cmi5Client,
  Cmi5Error,
  parseCmi5Launch,
  type Cmi5LaunchData,
} from './cmi5.js';
import { ScormClient } from './client.js';
import type { FetchLike } from './http/http-client.js';

const ACTOR = { objectType: 'Agent' as const, mbox: 'mailto:ada@example.com' };
const REG = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const AU = 'urn:uuid:au-1';
const ENDPOINT = 'https://lms.test/api/v1/xapi/';
const FETCH = 'https://lms.test/api/v1/cmi5/fetch?session=s&key=k';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function launchUrl(overrides: Record<string, string | null> = {}): string {
  const url = new URL('https://cdn.test/au/index.html');
  const params: Record<string, string | null> = {
    endpoint: ENDPOINT,
    fetch: FETCH,
    actor: JSON.stringify(ACTOR),
    registration: REG,
    activityId: AU,
    ...overrides,
  };
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  return url.toString();
}

function launchData(over: Partial<Cmi5LaunchData> = {}): Cmi5LaunchData {
  return {
    contextTemplate: {
      contextActivities: { grouping: [{ objectType: 'Activity', id: 'https://example.com/au/1' }] },
      extensions: { [CMI5_SESSION_EXTENSION]: SESSION },
    },
    launchMode: 'Normal',
    moveOn: 'CompletedAndPassed',
    ...over,
  };
}

/** A fake LMS + LRS: answers the fetch URL, LaunchData, and statement POSTs. */
function fakeLrs(data: Cmi5LaunchData = launchData(), preferences?: unknown) {
  const statements: any[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let redeemed = false;
  const fetchMock = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init });
    if (url === FETCH) {
      if (redeemed) return jsonResponse({ 'error-code': '1', 'error-text': 'already used' }, 401);
      redeemed = true;
      return jsonResponse({ 'auth-token': 'dG9rZW4=' });
    }
    if (url.startsWith(`${ENDPOINT}activities/state`)) return jsonResponse(data);
    if (url.startsWith(`${ENDPOINT}agents/profile`) && preferences) return jsonResponse(preferences);
    if (url === `${ENDPOINT}statements`) {
      statements.push(JSON.parse(init.body as string));
      return jsonResponse([statements.at(-1).id]);
    }
    return jsonResponse({ code: 'not_found' }, 404);
  });
  return { fetchMock, statements, calls };
}

let seq = 0;
function session(lrs: ReturnType<typeof fakeLrs>, now = () => 1_000_000) {
  return new Cmi5AuSession({
    launch: parseCmi5Launch(launchUrl()),
    fetch: lrs.fetchMock,
    now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
}

describe('parseCmi5Launch', () => {
  it('reads all five launch parameters', () => {
    expect(parseCmi5Launch(launchUrl())).toEqual({
      endpoint: ENDPOINT,
      fetch: FETCH,
      actor: ACTOR,
      registration: REG,
      activityId: AU,
    });
  });

  it('names the missing parameter', () => {
    expect(() => parseCmi5Launch(launchUrl({ fetch: null }))).toThrow(/"fetch"/);
    expect(() => parseCmi5Launch(launchUrl({ actor: '{nope' }))).toThrow(Cmi5Error);
  });
});

describe('Cmi5AuSession', () => {
  it('initializes: redeems the fetch URL, loads LaunchData, sends initialized', async () => {
    const lrs = fakeLrs();
    const au = session(lrs);
    await au.initialize();

    expect(au.status).toBe('initialized');
    expect(au.sessionId).toBe(SESSION);
    expect(lrs.calls[0]!.url).toBe(FETCH);
    expect(lrs.calls[0]!.init.method).toBe('POST');

    const stateCall = new URL(lrs.calls[1]!.url);
    expect(stateCall.searchParams.get('stateId')).toBe('LMS.LaunchData');
    expect(stateCall.searchParams.get('registration')).toBe(REG);
    const headers = lrs.calls[1]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic dG9rZW4=');
    expect(headers['X-Experience-API-Version']).toBe('1.0.3');

    const [init] = lrs.statements;
    expect(init.verb.id).toBe(CMI5_VERBS.initialized);
    expect(init.object.id).toBe(AU);
    expect(init.context.registration).toBe(REG);
    expect(init.context.extensions[CMI5_SESSION_EXTENSION]).toBe(SESSION);
    expect(init.context.contextActivities.grouping[0].id).toBe('https://example.com/au/1');
    expect(init.context.contextActivities.category).toEqual([
      { objectType: 'Activity', id: CMI5_CATEGORY.cmi5 },
    ]);
  });

  it('sends moveOn statements with the right result and categories, then terminates', async () => {
    let t = 1_000_000;
    const lrs = fakeLrs();
    const au = session(lrs, () => t);
    await au.initialize();
    t += 90_000;
    await au.passed({ scaled: 0.9 });
    await au.completed();
    await au.terminate();

    const [, passed, completed, terminated] = lrs.statements;
    expect(passed.result).toEqual({ success: true, duration: 'PT90S', score: { scaled: 0.9 } });
    expect(passed.context.contextActivities.category.map((c: { id: string }) => c.id)).toEqual([
      CMI5_CATEGORY.cmi5,
      CMI5_CATEGORY.moveOn,
    ]);
    expect(completed.result).toMatchObject({ completion: true });
    expect(terminated.verb.id).toBe(CMI5_VERBS.terminated);
    expect(terminated.result.duration).toBe('PT90S');
    expect(au.status).toBe('terminated');
    await expect(au.completed()).rejects.toThrow(/terminated/);
  });

  it('refuses what the LMS would reject', async () => {
    const lrs = fakeLrs(launchData({ masteryScore: 0.8 }));
    const au = session(lrs);
    await expect(au.completed()).rejects.toThrow(/initialize/);
    await au.initialize();

    await expect(au.passed()).rejects.toThrow(/score.scaled/);
    await expect(au.passed({ scaled: 0.5 })).rejects.toThrow(/below/);
    await expect(au.failed({ scaled: 0.9 })).rejects.toThrow(/send passed/);
    await au.completed();
    await expect(au.completed()).rejects.toThrow(/already/);
    await expect(au.send({ verb: { id: CMI5_VERBS.passed } })).rejects.toThrow(/dedicated/);
  });

  it('blocks moveOn verbs in Browse mode but allows other statements', async () => {
    const lrs = fakeLrs(launchData({ launchMode: 'Browse' }));
    const au = session(lrs);
    await au.initialize();
    await expect(au.completed()).rejects.toThrow(/Browse/);

    await au.send({ verb: { id: 'http://adlnet.gov/expapi/verbs/experienced' } });
    const sent = lrs.statements.at(-1);
    expect(sent.context.extensions[CMI5_SESSION_EXTENSION]).toBe(SESSION);
    expect(sent.context.contextActivities.category).toBeUndefined();
  });

  it('reads cmi5LearnerPreferences from the LRS, or null when none are stored', async () => {
    const prefs = { languagePreference: 'fr-FR,en-US', audioPreference: 'off' };
    const withPrefs = fakeLrs(launchData(), prefs);
    const au = session(withPrefs);
    await expect(au.learnerPreferences()).rejects.toThrow(/initialize/);
    await au.initialize();
    expect(await au.learnerPreferences()).toEqual(prefs);
    const url = new URL(withPrefs.calls.at(-1)!.url);
    expect(url.pathname).toBe('/api/v1/xapi/agents/profile');
    expect(url.searchParams.get('profileId')).toBe('cmi5LearnerPreferences');
    expect(JSON.parse(url.searchParams.get('agent')!)).toEqual(ACTOR);

    const none = session(fakeLrs());
    await none.initialize();
    expect(await none.learnerPreferences()).toBeNull();
  });

  it('surfaces the LMS error text when the fetch URL is already used', async () => {
    const lrs = fakeLrs();
    await session(lrs).initialize();
    await expect(session(lrs).initialize()).rejects.toThrow(/already used/);
  });
});

describe('Cmi5Client', () => {
  it('hits the /cmi5 REST surface with the API key', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'x' }));
    const client = new Cmi5Client({ baseUrl: 'https://e/api/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });

    await client.register({ courseId: 'c1', learnerId: 'u1' });
    await client.launch(REG, { auId: 'https://example.com/au/1', launchMode: 'Review' });
    await client.waive(REG, { auId: 'a', reason: 'Tested Out' });
    await client.getRegistration(REG);

    const urls = fetchMock.mock.calls.map((c) => [c[1].method, c[0]]);
    expect(urls).toEqual([
      ['POST', 'https://e/api/v1/cmi5/registrations'],
      ['POST', `https://e/api/v1/cmi5/registrations/${REG}/launch`],
      ['POST', `https://e/api/v1/cmi5/registrations/${REG}/waive`],
      ['GET', `https://e/api/v1/cmi5/registrations/${REG}`],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({
      auId: 'https://example.com/au/1',
      launchMode: 'Review',
    });
    expect((fetchMock.mock.calls[0]![1].headers as Record<string, string>)['X-API-Key']).toBe('k');
  });

  it('reads and replaces learner preferences, mapping 404 to null', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ code: 'preferences_not_found', message: 'none' }, 404))
      .mockResolvedValueOnce(jsonResponse({ audioPreference: 'on' }))
      .mockResolvedValueOnce(jsonResponse({ audioPreference: 'on' }));
    const client = new Cmi5Client({ baseUrl: 'https://e/api/v1', fetch: fetchMock, retries: 0 });

    expect(await client.getLearnerPreferences({ learnerId: 'u1' })).toBeNull();
    expect(await client.setLearnerPreferences({ actor: ACTOR }, { audioPreference: 'on' })).toEqual({
      audioPreference: 'on',
    });
    await client.getLearnerPreferences({ actor: ACTOR });

    const [get404, put, get] = fetchMock.mock.calls;
    expect(get404![0]).toBe('https://e/api/v1/cmi5/learner-preferences?learnerId=u1');
    expect(put![1].method).toBe('PUT');
    expect(JSON.parse(put![1].body as string)).toEqual({ actor: ACTOR, audioPreference: 'on' });
    expect(new URL(get![0]).searchParams.get('agent')).toBe(JSON.stringify(ACTOR));
  });

  it('never retries a launch', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'boom' }, 503));
    const client = new Cmi5Client({ baseUrl: 'https://e/api/v1', fetch: fetchMock, retries: 3, retryBaseMs: 0 });
    await expect(client.launch(REG, { auId: 'a' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads a course as multipart', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'c1' }, 201));
    const client = new Cmi5Client({ baseUrl: 'https://e/api/v1', fetch: fetchMock, retries: 0 });
    await client.importCourse(new Blob(['<courseStructure/>']), { title: 'T' });
    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.get('title')).toBe('T');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('is exposed on the ScormClient facade', () => {
    const client = new ScormClient({ baseUrl: 'https://e/api/v1', fetch: vi.fn<FetchLike>() });
    expect(client.cmi5).toBeInstanceOf(Cmi5Client);
    expect(client.cmi5.http).toBe(client.http);
  });
});
