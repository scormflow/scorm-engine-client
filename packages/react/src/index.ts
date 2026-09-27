/**
 * @scormflow/react — React bindings for the ScormFlow player.
 *
 * `useScormPlayer` manages a SCORM attempt's lifecycle inside a React-managed
 * container; `<ScormPlayer/>` is a drop-in component built on it.
 */
export { useScormPlayer } from './use-scorm-player.js';
export type {
  UseScormPlayerOptions,
  UseScormPlayerResult,
  ScormPlayerStatus,
} from './use-scorm-player.js';

export { ScormPlayer } from './scorm-player.js';
export type { ScormPlayerProps } from './scorm-player.js';
