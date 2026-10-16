import type { ReplayRecorder } from '@scormflow/sdk';

export interface ReplayCaptureOptions {
  /** Buffers and sends the events (`new ReplayRecorder({ replay: client.replay, attemptId })`). */
  recorder: ReplayRecorder;
  /** Host window: tab visibility and the `pagehide` flush. Defaults to the current `window`. */
  window?: Window;
  /**
   * The content iframe. Activity, pointer and media events inside it are
   * captured when it is same-origin (cross-origin content is skipped silently),
   * and re-bound each time the SCO navigates.
   */
  iframe?: HTMLIFrameElement;
  /** No input for this long records `idle.start`; the next input `idle.end`. `0` turns it off. Default 60 000. */
  idleMs?: number;
  /** Record where the learner clicks in the content (x / y relative to its viewport). Default false. */
  pointer?: boolean;
  /** Record audio / video play, pause and end inside the content. Default true. */
  media?: boolean;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const MEDIA_EVENTS = { play: 'media.play', pause: 'media.pause', ended: 'media.ended' } as const;
/** Pointer moves fire constantly; resetting the idle timer more often than this is wasted work. */
const ACTIVITY_THROTTLE_MS = 1000;

type Unlisten = () => void;

function listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): Unlisten {
  // An options object, not a bare boolean: some EventTarget implementations
  // (Node's) ignore a boolean `capture` on removal and would leak the listener.
  const options = { capture };
  target.addEventListener(type, fn, options);
  return () => target.removeEventListener(type, fn, options);
}

/**
 * Feed a {@link ReplayRecorder} from the browser: tab hidden / visible, idle
 * stretches, (optionally) pointer positions, and media playback inside the
 * content. Flushes with `keepalive` on `pagehide` so the last events survive
 * the tab closing. Returns a function that removes every listener.
 *
 * Capture is opt-in: nothing is recorded unless the host calls this (or
 * passes `replay` to `mountScormPlayer`). Keystrokes and typed text are never
 * recorded — key presses only count as activity.
 */
export function attachReplayCapture(opts: ReplayCaptureOptions): () => void {
  const { recorder } = opts;
  const win = opts.window ?? (globalThis as unknown as Window);
  const idleMs = opts.idleMs ?? 60_000;
  const host: Unlisten[] = [];
  let content: Unlisten[] = [];

  // ── visibility ──────────────────────────────────────────────────────
  const doc = win.document as Document | undefined;
  let hidden = doc?.visibilityState === 'hidden';
  if (doc) {
    host.push(
      listen(doc, 'visibilitychange', () => {
        const now = doc.visibilityState === 'hidden';
        if (now === hidden) return;
        hidden = now;
        recorder.record(now ? 'page.hidden' : 'page.visible');
      }),
    );
  }
  host.push(listen(win, 'pagehide', () => void recorder.flush({ keepalive: true })));

  // ── idle ────────────────────────────────────────────────────────────
  let idle = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReset = 0;
  const armIdle = () => {
    if (idleMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      recorder.record('idle.start');
    }, idleMs);
  };
  const onActivity = () => {
    if (idle) {
      idle = false;
      recorder.record('idle.end');
    } else if (Date.now() - lastReset < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastReset = Date.now();
    armIdle();
  };
  armIdle();
  if (doc) for (const type of ACTIVITY_EVENTS) host.push(listen(doc, type, onActivity, true));

  // ── inside the content ──────────────────────────────────────────────
  const bindContent = () => {
    content.forEach((off) => off());
    content = [];
    let inner: Document | null = null;
    try {
      inner = opts.iframe?.contentDocument ?? null;
    } catch {
      inner = null; // cross-origin
    }
    if (!inner) return;
    const view = inner.defaultView;
    for (const type of ACTIVITY_EVENTS) content.push(listen(inner, type, onActivity, true));

    if (opts.pointer) {
      content.push(
        listen(
          inner,
          'pointerdown',
          (e) => {
            const { clientX, clientY } = e as PointerEvent;
            const width = view?.innerWidth ?? 0;
            const height = view?.innerHeight ?? 0;
            if (!width || !height || typeof clientX !== 'number' || typeof clientY !== 'number') return;
            recorder.record('pointer', { data: { x: unit(clientX / width), y: unit(clientY / height) } });
          },
          true,
        ),
      );
    }

    if (opts.media !== false) {
      for (const [type, name] of Object.entries(MEDIA_EVENTS)) {
        // Media events don't bubble; listen in the capture phase.
        content.push(
          listen(
            inner,
            type,
            (e) => {
              const media = e.target as Partial<HTMLMediaElement> | null;
              const data: Record<string, unknown> = {};
              const src = media?.currentSrc || media?.src;
              if (typeof src === 'string' && src) data['src'] = src.slice(0, 200);
              if (typeof media?.currentTime === 'number') data['time'] = Math.round(media.currentTime * 10) / 10;
              recorder.record(name, { data });
            },
            true,
          ),
        );
      }
    }
  };
  if (opts.iframe) {
    host.push(listen(opts.iframe, 'load', bindContent));
    bindContent();
  }

  return () => {
    host.forEach((off) => off());
    content.forEach((off) => off());
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
}

const unit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
