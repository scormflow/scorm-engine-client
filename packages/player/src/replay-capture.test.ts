import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayRecorder, type ReplayEvent } from '@scormflow/sdk';

import { attachReplayCapture } from './replay-capture.js';

/** Node's EventTarget stands in for window / document / iframe. */
function fakeDom() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = Object.assign(new EventTarget(), { document: doc });
  const inner = Object.assign(new EventTarget(), { defaultView: { innerWidth: 200, innerHeight: 100 } });
  const iframe = Object.assign(new EventTarget(), { contentDocument: inner as unknown });
  return { doc, win, inner, iframe };
}

function setup(options: { pointer?: boolean; idleMs?: number } = {}) {
  const sent: ReplayEvent[][] = [];
  const keepalive: boolean[] = [];
  const recorder = new ReplayRecorder({
    replay: {
      recordEvents: async (_id, events, o) => {
        sent.push([...events]);
        keepalive.push(Boolean(o?.keepalive));
        return { accepted: events.length, duplicates: 0, dropped: 0 };
      },
    },
    attemptId: 'att_1',
    flushIntervalMs: 0,
  });
  const dom = fakeDom();
  const detach = attachReplayCapture({
    recorder,
    window: dom.win as unknown as Window,
    iframe: dom.iframe as unknown as HTMLIFrameElement,
    ...options,
  });
  const types = async () => {
    await recorder.flush();
    return sent.flat().map((e) => e.type);
  };
  return { ...dom, recorder, detach, sent, keepalive, types };
}

describe('attachReplayCapture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records tab visibility changes once per change', async () => {
    const { doc, types } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(await types()).toEqual(['page.hidden', 'page.visible']);
  });

  it('records idle stretches from activity in the host page and the content', async () => {
    const { doc, inner, types } = setup({ idleMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    inner.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(3000);
    doc.dispatchEvent(new Event('pointermove'));
    await vi.advanceTimersByTimeAsync(4000);
    // Activity 4 s ago re-armed the timer, so still not idle.
    expect(await types()).toEqual(['idle.start', 'idle.end']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await types()).toEqual(['idle.start', 'idle.end', 'idle.start']);
  });

  it('records pointer positions only when asked, relative to the content viewport', async () => {
    const off = setup();
    off.inner.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 50, clientY: 25 }));
    expect(await off.types()).toEqual([]);

    const on = setup({ pointer: true });
    on.inner.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 50, clientY: 25 }));
    await on.recorder.flush();
    expect(on.sent.flat()[0]).toMatchObject({ type: 'pointer', data: { x: 0.25, y: 0.25 } });
  });

  it('records media playback inside the content', async () => {
    const { inner, types } = setup();
    inner.dispatchEvent(new Event('play'));
    inner.dispatchEvent(new Event('ended'));
    expect(await types()).toEqual(['media.play', 'media.ended']);
  });

  it('re-binds when the content navigates and skips cross-origin documents', async () => {
    const { iframe, inner, types } = setup();
    const next = Object.assign(new EventTarget(), { defaultView: { innerWidth: 1, innerHeight: 1 } });
    iframe.contentDocument = next;
    iframe.dispatchEvent(new Event('load'));
    inner.dispatchEvent(new Event('play'));
    next.dispatchEvent(new Event('pause'));

    Object.defineProperty(iframe, 'contentDocument', {
      get() {
        throw new Error('SecurityError');
      },
    });
    iframe.dispatchEvent(new Event('load'));
    next.dispatchEvent(new Event('play'));
    expect(await types()).toEqual(['media.pause']);
  });

  it('flushes with keepalive on pagehide and stops listening once detached', async () => {
    const { win, doc, recorder, detach, keepalive, types } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(keepalive).toEqual([true]);

    detach();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(recorder.pending).toBe(0);
    expect(await types()).toEqual(['page.hidden']);
  });
});
