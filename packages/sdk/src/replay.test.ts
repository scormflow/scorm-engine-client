import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import { ScormHttpError } from './errors.js';
import type { FetchLike } from './http/http-client.js';
import {
  isReplayCaptureDisabled,
  ReplayClient,
  ReplayRecorder,
  type AttemptReplay,
  type ReplayEvent,
} from './replay.js';

const BASE = 'https://engine.test/api/v1';

const httpError = (status: number, code: string) => new ScormHttpError(status, { code, message: code }, code);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = new ReplayClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries: 0 });
  return { client, calls };
}

const REPLAY: AttemptReplay = {
  attemptId: 'att_1',
  courseId: 'course_1',
  learner: { id: 'learner-1', name: 'Ada' },
  status: 'COMPLETED',
  completionStatus: 'COMPLETED',
  successStatus: 'PASSED',
  startedAt: '2026-10-16T09:00:00.000Z',
  endedAt: '2026-10-16T09:05:00.000Z',
  durationSeconds: 300,
  commits: 3,
  captured: false,
  truncated: false,
  entries: [],
  visits: [],
  engagement: {
    score: 100,
    level: 'high',
    components: { progress: 1, focus: null, interactivity: null },
    activeSeconds: 300,
    hiddenSeconds: 0,
    idleSeconds: 0,
    focusLosses: 0,
    interactions: 0,
    locationsVisited: 0,
  },
};

describe('ReplayClient', () => {
  it('reads a replay and a course heatmap', async () => {
    const { client, calls } = setup((url) =>
      url.includes('/heatmap')
        ? jsonResponse({ courseId: 'course_1', attempts: 0, completed: 0, grid: 10, truncated: false, locations: [] })
        : jsonResponse(REPLAY),
    );
    expect(await client.attempt('att_1')).toEqual(REPLAY);
    expect(calls[0]!.url).toBe(`${BASE}/attempts/att_1/replay`);

    await client.courseHeatmap('course 1', { limit: 20, since: new Date('2026-10-01T00:00:00.000Z') });
    expect(calls[1]!.url).toBe(
      `${BASE}/courses/course%201/heatmap?limit=20&since=2026-10-01T00%3A00%3A00.000Z`,
    );
  });

  it('posts capture events, with keepalive on request', async () => {
    const { client, calls } = setup(() => jsonResponse({ accepted: 1, duplicates: 0, dropped: 0 }));
    const events: ReplayEvent[] = [{ id: 'e1', type: 'page.hidden', at: '2026-10-16T09:00:00.000Z' }];
    expect(await client.recordEvents('att_1', events)).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });
    expect(calls[0]!.url).toBe(`${BASE}/attempts/att_1/replay/events`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ events });
    expect(calls[0]!.init.keepalive).toBeUndefined();

    await client.recordEvents('att_1', events, { keepalive: true });
    expect(calls[1]!.init.keepalive).toBe(true);
  });

  it('is exposed on the facade', () => {
    const client = new ScormClient({ baseUrl: BASE, fetch: vi.fn<FetchLike>() });
    expect(client.replay).toBeInstanceOf(ReplayClient);
  });

  it('recognizes a disabled-capture answer', async () => {
    const { client } = setup(() =>
      jsonResponse({ code: 'replay_capture_disabled', message: 'Session replay capture is turned off' }, 403),
    );
    const err = await client.recordEvents('att_1', [{ type: 'page.hidden', at: new Date().toISOString() }]).catch((e) => e);
    expect(isReplayCaptureDisabled(err)).toBe(true);
    expect(isReplayCaptureDisabled(httpError(403, 'forbidden'))).toBe(false);
    expect(isReplayCaptureDisabled(new Error('x'))).toBe(false);
  });
});

describe('ReplayRecorder', () => {
  afterEach(() => vi.useRealTimers());

  const clock = () => {
    let t = Date.parse('2026-10-16T09:00:00.000Z');
    return () => new Date((t += 1000));
  };

  function recorderWith(
    recordEvents: (attemptId: string, events: readonly ReplayEvent[], o?: { keepalive?: boolean }) => Promise<unknown>,
    extra: Partial<ConstructorParameters<typeof ReplayRecorder>[0]> = {},
  ) {
    const spy = vi.fn(recordEvents);
    const recorder = new ReplayRecorder({
      replay: { recordEvents: spy as never },
      attemptId: 'att_1',
      flushIntervalMs: 0,
      now: clock(),
      ...extra,
    });
    return { recorder, spy };
  }

  it('batches events with ids and only records navigation on a change', async () => {
    const { recorder, spy } = recorderWith(async () => ({ accepted: 3, duplicates: 0, dropped: 0 }));
    recorder.navigate('slide-1');
    recorder.navigate('slide-1');
    recorder.record('pointer', { data: { x: 0.5, y: 0.5 } });
    recorder.navigate('slide-2');
    expect(recorder.pending).toBe(3);
    expect(recorder.currentLocation).toBe('slide-2');

    await recorder.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    const [attemptId, batch] = spy.mock.calls[0]!;
    expect(attemptId).toBe('att_1');
    expect(batch.map((e) => e.type)).toEqual(['navigation', 'pointer', 'navigation']);
    expect(batch[0]).toMatchObject({ location: 'slide-1', at: '2026-10-16T09:00:01.000Z' });
    expect(new Set(batch.map((e) => e.id)).size).toBe(3);
    expect(recorder.pending).toBe(0);
  });

  it('flushes a full batch on its own and splits large buffers', async () => {
    const { recorder, spy } = recorderWith(async () => ({}), { maxBatch: 2 });
    recorder.record('a.one');
    recorder.record('a.two');
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    recorder.record('a.three');
    recorder.record('a.four');
    recorder.record('a.five');
    await recorder.flush();
    expect(spy.mock.calls.flatMap(([, b]) => b.map((e) => e.type))).toEqual([
      'a.one',
      'a.two',
      'a.three',
      'a.four',
      'a.five',
    ]);
  });

  it('keeps events across a transient failure and resends them with the same ids', async () => {
    let fail = true;
    const onError = vi.fn();
    const { recorder, spy } = recorderWith(
      async () => {
        if (fail) throw httpError(503, 'unavailable');
        return {};
      },
      { onError },
    );
    recorder.record('page.hidden');
    await recorder.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(recorder.pending).toBe(1);

    fail = false;
    await recorder.flush();
    expect(recorder.pending).toBe(0);
    expect(spy.mock.calls[1]![1][0]!.id).toBe(spy.mock.calls[0]![1][0]!.id);
  });

  it('drops a batch the engine rejects as malformed', async () => {
    const { recorder } = recorderWith(async () => {
      throw httpError(400, 'invalid_request');
    });
    recorder.record('page.hidden');
    await recorder.flush();
    expect(recorder.pending).toBe(0);
  });

  it('turns itself off when the engine has capture disabled', async () => {
    const onDisabled = vi.fn();
    const { recorder, spy } = recorderWith(
      async () => {
        throw httpError(403, 'replay_capture_disabled');
      },
      { onDisabled },
    );
    recorder.record('page.hidden');
    await recorder.flush();
    expect(onDisabled).toHaveBeenCalledTimes(1);
    expect(recorder.disabled).toBe(true);
    recorder.record('page.visible');
    expect(recorder.pending).toBe(0);
    await recorder.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caps the buffer, flushes on an interval, and sends small keepalive batches on stop', async () => {
    vi.useFakeTimers();
    const { recorder, spy } = recorderWith(async () => ({}), { flushIntervalMs: 1000, maxBatch: 100, maxBuffered: 100 });
    recorder.record('tick.one');
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockImplementation(async () => {
      throw httpError(503, 'unavailable');
    });
    for (let i = 0; i < 150; i++) recorder.record('tick.many');
    await vi.advanceTimersByTimeAsync(0);
    expect(recorder.pending).toBe(100);

    spy.mockImplementation(async () => ({}));
    spy.mockClear();
    await recorder.stop({ keepalive: true });
    expect(spy.mock.calls.map(([, b, o]) => [b.length, o?.keepalive])).toEqual([
      [25, true],
      [25, true],
      [25, true],
      [25, true],
    ]);
    recorder.record('after.stop');
    expect(recorder.pending).toBe(0);
  });
});
