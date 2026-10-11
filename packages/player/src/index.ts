/**
 * @scormflow/player — a clean-room, browser-side SCORM runtime.
 *
 * Exposes `window.API` (SCORM 1.2) and `window.API_1484_11` (SCORM 2004) to SCO
 * content and drives them through a `@scormflow/sdk` transport. No third-party
 * SCORM libraries are bundled.
 */
export { mountScormPlayer, attachScormApi } from './mount.js';
export type {
  MountScormPlayerOptions,
  ScormPlayerHandle,
  ScormWindow,
} from './mount.js';

export { RuntimeCore } from './runtime.js';
export type { RuntimeCoreOptions } from './runtime.js';

export { CmiStore } from './cmi-store.js';

export { createScorm12Api } from './api-scorm12.js';
export type { Scorm12Api } from './api-scorm12.js';
export { createScorm2004Api } from './api-scorm2004.js';
export type { Scorm2004Api } from './api-scorm2004.js';

export {
  errorString,
  Scorm12Error,
  Scorm2004Error,
  NO_ERROR,
} from './errors.js';
