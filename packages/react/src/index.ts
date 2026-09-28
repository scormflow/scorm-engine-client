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

export { useAsyncResource } from './use-resource.js';
export type { AsyncResource } from './use-resource.js';

export { useCourse, useCourseAnalytics } from './use-course.js';
export { useScormUpload } from './use-scorm-upload.js';
export type { UseScormUploadResult, UploadStatus } from './use-scorm-upload.js';
