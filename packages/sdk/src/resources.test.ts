import { describe, expect, it, vi } from 'vitest';

import { ResourceClient } from './resources.js';
import type { FetchLike } from './http/http-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ResourceClient', () => {
  it('lists courses', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: [{ id: 'c1', title: 'Intro' }], pagination: { nextCursor: null, hasMore: false } }),
    );
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });
    const res = await rc.listCourses();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/courses');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect(res.data[0]!.id).toBe('c1');
  });

  it('gets a single course', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'c1', title: 'Intro' }));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const res = await rc.getCourse('c1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/courses/c1');
    expect(res.title).toBe('Intro');
  });

  it('fetches course analytics', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ courseId: 'c1', attemptCount: 5, completionCount: 3, completionRate: 0.6, averageScore: 0.7, averageTimeSeconds: 300, passRate: 0.5, recentAttempts: [] }),
    );
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const res = await rc.getCourseAnalytics('c1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/analytics/courses/c1');
    expect(res.completionRate).toBe(0.6);
  });

  it('fetches the tenant overview and learner analytics', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ courseCount: 2, learnerCount: 4, attemptCount: 9, completionRate: 0.4, averageScore: null }))
      .mockResolvedValueOnce(jsonResponse({ learnerId: 'u1', attemptCount: 3, completedCourseCount: 1, totalTimeSeconds: 900, recentAttempts: [] }));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });

    const overview = await rc.getOverview();
    expect(overview.attemptCount).toBe(9);
    expect(overview.averageScore).toBeNull();

    const learner = await rc.getLearnerAnalytics('u1');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://x/v1/analytics/learners/u1');
    expect(learner.totalTimeSeconds).toBe(900);
  });

  it('uploads a package as multipart via fetch when no progress is requested', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ id: 'c9', title: 'Uploaded' }, 201));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });
    const file = new Blob(['zip-bytes'], { type: 'application/zip' });

    const res = await rc.uploadCourse(file, { title: 'Uploaded' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/courses');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('title')).toBe('Uploaded');
    // No JSON content-type forced for multipart uploads.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(res.id).toBe('c9');
  });

  it('surfaces HTTP errors', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'course_not_found', message: 'nope' }, 404));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await expect(rc.getCourse('missing')).rejects.toMatchObject({ status: 404, code: 'course_not_found' });
  });
});
