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

  it('fetches trends, passing only the query params that are set', async () => {
    const trends = { courseId: null, interval: 'day', from: '2026-10-19', to: '2026-10-20', buckets: [], totals: { started: 0, completed: 0, passed: 0, failed: 0 } };
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(trends));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });

    await rc.getTrends();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/analytics/trends');
    await rc.getTrends({ days: 7, courseId: 'c 1' });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://x/v1/analytics/trends?days=7&courseId=c+1');
  });

  it('fetches a course score distribution', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ courseId: 'c1', scoredCount: 1, averageScore: 0.8, medianScore: 0.8, bins: [] }),
    );
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const res = await rc.getScoreDistribution('c1', { bins: 5 });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/analytics/courses/c1/scores?bins=5');
    expect(res.medianScore).toBe(0.8);
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
    // Fields must precede the file or the engine never reads them.
    expect([...(init.body as FormData).keys()]).toEqual(['title', 'file']);
    // No JSON content-type forced for multipart uploads.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(res.id).toBe('c9');
  });

  it('validates a package as multipart and returns the report, valid or not', async () => {
    const report = {
      valid: false,
      version: 'SCORM_1_2',
      errors: [
        { code: 'missing_launch_file', severity: 'error', category: 'resources', message: 'gone', path: 'a.html' },
      ],
      warnings: [],
      info: [],
      stats: { fileCount: 1, totalBytes: 10, launchableCount: 1, scannedFiles: 0 },
      manifest: null,
    };
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(report));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: fetchMock, retries: 0 });

    const res = await rc.validateCourse(new Blob(['zip-bytes']));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/courses/validate');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe('missing_launch_file');
  });

  it('surfaces HTTP errors', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'course_not_found', message: 'nope' }, 404));
    const rc = new ResourceClient({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await expect(rc.getCourse('missing')).rejects.toMatchObject({ status: 404, code: 'course_not_found' });
  });

  describe('health and readiness', () => {
    it('reads liveness and the engine version', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ status: 'ok', version: '0.0.1' }));
      const rc = new ResourceClient({ baseUrl: 'https://x/api/v1', fetch: fetchMock });
      await expect(rc.getHealth()).resolves.toEqual({ status: 'ok', version: '0.0.1' });
      expect(fetchMock.mock.calls[0]![0]).toBe('https://x/api/v1/health');
    });

    it('returns the report when ready', async () => {
      const report = { status: 'ready', checks: { database: 'ok', storage: 'ok' } };
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(report));
      const rc = new ResourceClient({ baseUrl: 'https://x/api/v1', fetch: fetchMock });
      await expect(rc.getReadiness()).resolves.toEqual(report);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://x/api/v1/ready');
    });

    it('resolves a 503 report without retrying', async () => {
      const report = { status: 'not_ready', checks: { database: 'ok', storage: 'error' } };
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(report, 503));
      // Client-wide retries are on; a probe must still make exactly one call.
      const rc = new ResourceClient({ baseUrl: 'https://x/api/v1', fetch: fetchMock, retries: 3, retryBaseMs: 1 });
      await expect(rc.getReadiness()).resolves.toEqual(report);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still throws on a 503 that is not a readiness report', async () => {
      const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ code: 'unavailable', message: 'proxy down' }, 503));
      const rc = new ResourceClient({ baseUrl: 'https://x/api/v1', fetch: fetchMock });
      await expect(rc.getReadiness()).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    });
  });
});
