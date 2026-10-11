import type { ScormTransport } from '@scormflow/sdk';

import { createScorm12Api, type Scorm12Api } from './api-scorm12.js';
import { createScorm2004Api, type Scorm2004Api } from './api-scorm2004.js';
import { RuntimeCore, type RuntimeCoreOptions } from './runtime.js';

/** Window augmented with the SCORM API globals a SCO looks up. */
export interface ScormWindow {
  API?: Scorm12Api;
  API_1484_11?: Scorm2004Api;
}

/**
 * Attach the version-appropriate SCORM API global to a window so a SCO (in a
 * child iframe) can discover it via the standard parent/opener lookup walk.
 * Returns a detach function that removes the global again.
 */
export function attachScormApi(win: ScormWindow, core: RuntimeCore): () => void {
  if (core.version === 'SCORM_1_2') {
    win.API = createScorm12Api(core);
    return () => {
      delete win.API;
    };
  }
  win.API_1484_11 = createScorm2004Api(core);
  return () => {
    delete win.API_1484_11;
  };
}

export interface MountScormPlayerOptions
  extends Omit<RuntimeCoreOptions, 'transport'> {
  /** Where to mount the SCO iframe: a selector or element. */
  container: string | HTMLElement;
  /** The SCO entry URL to load in the iframe. */
  launchUrl: string;
  /** Engine transport (e.g. `RestTransport`) driving the attempt. */
  transport: ScormTransport;
  /** Window to expose the API on. Defaults to the current `window`. */
  targetWindow?: Window & ScormWindow;
  /** Extra attributes for the created iframe (e.g. `sandbox`, `title`). */
  iframeAttributes?: Record<string, string>;
}

export interface ScormPlayerHandle {
  readonly core: RuntimeCore;
  readonly iframe: HTMLIFrameElement;
  /** Force a background commit of pending writes. */
  commit(): Promise<void>;
  /** Terminate the attempt, detach the API global, and remove the iframe. */
  destroy(): Promise<void>;
}

/**
 * Mount a SCORM player: hydrate the runtime from the engine, expose the SCORM
 * API global, and embed the SCO in an iframe. The SCO then behaves exactly as
 * it would against any conformant LMS.
 */
export async function mountScormPlayer(
  opts: MountScormPlayerOptions,
): Promise<ScormPlayerHandle> {
  const container = resolveContainer(opts.container);
  const win = opts.targetWindow ?? (globalThis as unknown as Window & ScormWindow);

  const core = await RuntimeCore.create({
    attemptId: opts.attemptId,
    transport: opts.transport,
    ...(opts.autoCommitMs !== undefined ? { autoCommitMs: opts.autoCommitMs } : {}),
    ...(opts.onCommit ? { onCommit: opts.onCommit } : {}),
    ...(opts.onError ? { onError: opts.onError } : {}),
  });

  const detach = attachScormApi(win, core);

  const iframe = container.ownerDocument.createElement('iframe');
  iframe.setAttribute('title', 'SCORM content');
  for (const [k, v] of Object.entries(opts.iframeAttributes ?? {})) {
    iframe.setAttribute(k, v);
  }
  iframe.src = opts.launchUrl;
  container.appendChild(iframe);

  // Best-effort flush if the host page is closing before the SCO terminates.
  const onUnload = (): void => {
    void core.commit().catch((err) => core.reportError(err));
  };
  win.addEventListener?.('beforeunload', onUnload);

  return {
    core,
    iframe,
    async commit(): Promise<void> {
      await core.commit();
    },
    async destroy(): Promise<void> {
      win.removeEventListener?.('beforeunload', onUnload);
      await core.terminate();
      detach();
      iframe.remove();
    },
  };
}

function resolveContainer(container: string | HTMLElement): HTMLElement {
  if (typeof container !== 'string') return container;
  const el = document.querySelector<HTMLElement>(container);
  if (!el) throw new Error(`SCORM player container not found: ${container}`);
  return el;
}
