import { describe, expect, it, vi } from 'vitest';
import { RestTransport } from './rest.js';
import type { FetchLike } from '../http/http-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RestTransport', () => {
  it('starts an attempt against /courses/:courseId/attempts', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        attemptId: 'a1',
        resumed: false,
        version: 'SCORM_2004_4',
        entry: 'ab-initio',
        launch: { learnerId: 'u1', learnerName: 'Ada' },
        cmi: {},
      }),
    );
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const res = await t.startAttempt('c1', { learnerId: 'u1', learnerName: 'Ada' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/courses/c1/attempts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ learnerId: 'u1', learnerName: 'Ada' });
    expect(res.attemptId).toBe('a1');
    expect(res.resumed).toBe(false);
    expect(res.entry).toBe('ab-initio');
    expect(res.cmi).toEqual({});
  });

  it('initializes against GET /attempts/:attemptId/runtime', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        attemptId: 'a1',
        version: 'SCORM_2004_4',
        status: 'IN_PROGRESS',
        cmi: { 'cmi.completion_status': 'incomplete' },
        entry: 'resume',
        learner: { id: 'l-1', name: 'Ada' },
      }),
    );

    const t = new RestTransport({
      baseUrl: 'https://api.example.com/api/v1',
      apiKey: 'k',
      fetch: fetchMock,
      retries: 0,
    });
    const state = await t.initialize('a1');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/api/v1/attempts/a1/runtime');
    expect(init.method).toBe('GET');
    expect(state.version).toBe('SCORM_2004_4');
    expect(state.status).toBe('IN_PROGRESS');
    expect(state.cmi['cmi.completion_status']).toBe('incomplete');
    expect(state.learner).toEqual({ id: 'l-1', name: 'Ada' });
    expect(state.entry).toBe('resume');
  });

  it('url-encodes the attempt id', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ attemptId: 'a/1', version: 'SCORM_1_2', cmi: {} }),
    );
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await t.initialize('a/1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://x/v1/attempts/a%2F1/runtime');
  });

  it('sends a commit batch to /attempts/:id/commit with terminate:false', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: true, terminated: false, summary: { completionStatus: 'incomplete' } }),
    );
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const result = await t.commit('a1', { 'cmi.suspend_data': 's' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/attempts/a1/commit');
    expect(result.ok).toBe(true);
    expect(result.terminated).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual({
      values: { 'cmi.suspend_data': 's' },
      terminate: false,
    });
  });

  it('surfaces warnings and errors from the commit response', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse({
        ok: false,
        terminated: false,
        errors: [{ element: 'cmi.completion_status', code: 406, message: 'bad vocab' }],
        warnings: [{ element: 'cmi.bogus', code: 401, message: 'unknown' }],
      }),
    );
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    const result = await t.commit('a1', {});
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { element: 'cmi.completion_status', code: 406, message: 'bad vocab' },
    ]);
    expect(result.warnings).toEqual([{ element: 'cmi.bogus', code: 401, message: 'unknown' }]);
  });

  it('terminates via /commit with terminate:true and an empty batch', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ ok: true, terminated: true }));
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await t.terminate('a1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x/v1/attempts/a1/commit');
    expect(JSON.parse(init.body as string)).toEqual({ values: {}, terminate: true });
  });

  it('sends final values on terminate when provided', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse({ ok: true, terminated: true }));
    const t = new RestTransport({ baseUrl: 'https://x/v1', fetch: fetchMock, retries: 0 });
    await t.terminate('a1', { 'cmi.core.lesson_status': 'completed' });
    const init = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).toEqual({
      values: { 'cmi.core.lesson_status': 'completed' },
      terminate: true,
    });
  });
});
