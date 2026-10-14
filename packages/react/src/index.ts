/**
 * @scormflow/react — React bindings for the ScormFlow player.
 *
 * `useScormPlayer` manages a SCORM attempt's lifecycle inside a React-managed
 * container; `<ScormPlayer/>` is a drop-in component built on it.
 */
export {
  ScormProvider,
  useScormClient,
  useResourceClient,
  useScormTransport,
  useXapiClient,
  useCmi5Client,
  useWebhooksClient,
  useCertificatesClient,
  usePluginsClient,
  useOptionalScormClient,
} from './scorm-context.js';
export type { ScormProviderProps } from './scorm-context.js';

export { useScormPlayer } from './use-scorm-player.js';
export type {
  UseScormPlayerOptions,
  UseScormPlayerResult,
  ScormPlayerStatus,
} from './use-scorm-player.js';

export { useOfflineSync } from './use-offline-sync.js';
export type { UseOfflineSyncResult } from './use-offline-sync.js';

export { ScormPlayer } from './scorm-player.js';
export type { ScormPlayerProps } from './scorm-player.js';

export { useAsyncResource } from './use-resource.js';
export type { AsyncResource } from './use-resource.js';

export { useCourse, useCourseAnalytics } from './use-course.js';
export { useScormUpload } from './use-scorm-upload.js';
export type { UseScormUploadResult, UploadStatus } from './use-scorm-upload.js';

export {
  useXapiActivity,
  useXapiDocument,
  useXapiPerson,
  useXapiStatements,
} from './use-xapi.js';
export type { UseXapiDocumentResult } from './use-xapi.js';

export {
  useCmi5Course,
  useCmi5Launch,
  useCmi5LearnerPreferences,
  useCmi5Registration,
} from './use-cmi5.js';
export type { Cmi5LaunchStatus, UseCmi5LaunchResult } from './use-cmi5.js';

export { useWebhookDeliveries, useWebhookEndpoints } from './use-webhooks.js';

export { appendEngineEvent, useEngineEvents } from './use-engine-events.js';
export type { UseEngineEventsOptions, UseEngineEventsResult } from './use-engine-events.js';

export { useCertificate, useCertificates } from './use-certificates.js';
export { useLiveActivity, usePlugins, topEventTypes } from './use-plugins.js';
export type { UseLiveActivityOptions } from './use-plugins.js';
export { ScormCertificate, ScormCertificateView, formatCertificateDate } from './scorm-certificate.js';
export type { ScormCertificateProps, ScormCertificateViewProps } from './scorm-certificate.js';
