import { describe, expect, it, vi } from 'vitest';

import { ScormClient, createScormClient } from './client.js';
import { MemoryTransport } from './transports/memory.js';
import type { FetchLike } from './http/http-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ScormClient', () => {
  it('shares one HttpClient across every namespace', () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = new ScormClient({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: fetchMock });

    expect(client.rest.http).toBe(client.http);
    expect(client.resources.http).toBe(client.http);
    expect(client.runtime).toBe(client.rest);
  });

  it('routes courses.list / courses.get through the REST surface', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'c1', title: 'Intro' }], pagination: { nextCursor: null, hasMore: false } }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'c1', title: 'Intro' }));
    const client = new ScormClient({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });

    const list = await client.courses.list();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/courses');
    expect(list.data[0]!.id).toBe('c1');

    const course = await client.courses.get('c1');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://x/v1/courses/c1');
    expect(course.title).toBe('Intro');

    // Auth from the shared client reaches every namespace.
    const headers = fetchMock.mock.calls[1]![1].headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k');
  });

  it('starts an attempt via attempts.start', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ attemptId: 'a1', resumed: false, version: 'SCORM_1_2' }),
    );
    const client = new ScormClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });

    const res = await client.attempts.start('c1', { learnerId: 'u1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/courses/c1/attempts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ learnerId: 'u1' });
    expect(res.attemptId).toBe('a1');
    // Missing `cmi` is normalized to an empty snapshot.
    expect(res.cmi).toEqual({});
  });

  it('drives the runtime loop through the default REST transport', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: 'a1', version: 'SCORM_1_2', cmi: { 'cmi.core.lesson_status': 'incomplete' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ScormClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });

    const state = await client.runtime.initialize('a1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/attempts/a1/runtime');
    expect(state.cmi['cmi.core.lesson_status']).toBe('incomplete');

    const commit = await client.runtime.commit('a1', { 'cmi.core.score.raw': 80 });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://x/v1/attempts/a1/commit');
    expect(commit.ok).toBe(true);
  });

  it('maps the analytics namespace onto the read models', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse({ courseCount: 2, learnerCount: 4, attemptCount: 9, completionRate: 0.4, averageScore: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          courseId: 'c1',
          attemptCount: 5,
          completionCount: 3,
          completionRate: 0.6,
          averageScore: 0.7,
          averageTimeSeconds: 300,
          passRate: 0.5,
          recentAttempts: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ learnerId: 'u1', attemptCount: 3, completedCourseCount: 1, totalTimeSeconds: 900, recentAttempts: [] }),
      );
    const client = new ScormClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });

    expect((await client.analytics.overview()).attemptCount).toBe(9);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/analytics/overview');

    expect((await client.analytics.course('c1')).completionRate).toBe(0.6);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://x/v1/analytics/courses/c1');

    expect((await client.analytics.learner('u1')).totalTimeSeconds).toBe(900);
    expect(fetchMock.mock.calls[2]![0]).toBe('https://x/v1/analytics/learners/u1');
  });

  it('accepts an injected transport without disturbing the REST namespaces', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'c1', title: 'Intro' }));
    const memory = new MemoryTransport({
      initialState: { a1: { 'cmi.core.lesson_status': 'incomplete' } },
    });
    const client = new ScormClient({
      baseUrl: 'https://x/v1',
      fetch: fetchMock,
      retries: 0,
      transport: memory,
    });

    expect(client.runtime).toBe(memory);
    expect(client.rest).toBeDefined();

    // Runtime goes to memory — no HTTP traffic.
    const state = await client.runtime.initialize('a1');
    expect(state.attemptId).toBe('a1');
    expect(fetchMock).not.toHaveBeenCalled();

    // Courses still go over HTTP.
    await client.courses.get('c1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates HTTP errors from namespace calls', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ code: 'course_not_found', message: 'nope' }, 404),
    );
    const client = createScormClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await expect(client.courses.get('missing')).rejects.toMatchObject({
      status: 404,
      code: 'course_not_found',
    });
  });
});
