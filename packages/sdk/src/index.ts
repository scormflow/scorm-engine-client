export type {
  ScormTransport,
  RuntimeState,
  CommitOptions,
  CommitResult,
  CommitIssue,
  RuntimeSummary,
  TerminateOptions,
  ScormVersion,
  ScormEntry,
  ScormLearner,
} from './transport.js';

export {
  ScormError,
  ScormHttpError,
  ScormRateLimitError,
  ScormNetworkError,
  ScormTimeoutError,
  ScormAbortError,
  isRetryableStatus,
} from './errors.js';
export type { ScormErrorBody } from './errors.js';
export { parseRateLimit } from './http/retry.js';
export type { RateLimitInfo } from './http/retry.js';

export { HttpClient } from './http/http-client.js';
export type { HttpClientOptions, HttpRequest, FetchLike, TokenProvider } from './http/http-client.js';

export { MemoryTransport } from './transports/memory.js';
export type { MemoryTransportOptions } from './transports/memory.js';

export { LocalStorageTransport } from './transports/local-storage.js';
export type { LocalStorageTransportOptions, StorageLike } from './transports/local-storage.js';

export { ResourceClient } from './resources.js';
export type {
  ResourceClientOptions,
  Course,
  ScoSummary,
  CourseListResult,
  AnalyticsOverview,
  CourseAnalytics,
  LearnerAnalytics,
  UploadCourseOptions,
  EngineHealth,
  ReadinessReport,
  ReadinessCheckStatus,
} from './resources.js';

export { XapiClient, createXapiClient, XAPI_VERSION } from './xapi.js';
export type {
  XapiClientOptions,
  XapiAbout,
  XapiActivity,
  XapiAgent,
  XapiDocument,
  XapiDocumentApi,
  XapiFormat,
  XapiPerson,
  XapiProfileKey,
  XapiStatement,
  XapiStatementQuery,
  XapiStatementResult,
  XapiStateKey,
  XapiStateScope,
  XapiStoreOptions,
  XapiWriteOptions,
  XapiWriteResult,
} from './xapi.js';
export {
  decodeMultipart,
  decodeStatementResponse,
  encodeMultipart,
  encodeStatementUpload,
  prepareXapiAttachment,
  sha256Hex,
  XAPI_SIGNATURE_USAGE_TYPE,
} from './xapi-attachments.js';
export type {
  MultipartPart,
  XapiAttachment,
  XapiAttachmentBody,
  XapiAttachmentInput,
} from './xapi-attachments.js';

export {
  Cmi5AuSession,
  Cmi5Client,
  Cmi5Error,
  CMI5_CATEGORY,
  CMI5_LEARNER_PREFERENCES_PROFILE_ID,
  CMI5_SESSION_EXTENSION,
  CMI5_VERBS,
  parseCmi5Launch,
} from './cmi5.js';
export type {
  Cmi5Au,
  Cmi5AuProgress,
  Cmi5AuSessionOptions,
  Cmi5AuStatus,
  Cmi5BlockProgress,
  Cmi5Course,
  Cmi5CourseList,
  Cmi5LaunchData,
  Cmi5LaunchMethod,
  Cmi5LaunchMode,
  Cmi5LaunchParams,
  Cmi5LaunchRequest,
  Cmi5LaunchResult,
  Cmi5Learner,
  Cmi5LearnerPreferences,
  Cmi5MoveOn,
  Cmi5Registration,
  Cmi5RegistrationRequest,
  Cmi5Score,
  Cmi5StructureNode,
  Cmi5ValidationReport,
  Cmi5WaiveReason,
} from './cmi5.js';

export {
  constructWebhookEvent,
  verifyWebhookSignature,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookSignatureError,
  WebhooksClient,
} from './webhooks.js';
export type {
  CreateWebhookRequest,
  ObjectiveMasteredEventData,
  UpdateWebhookRequest,
  VerifyWebhookOptions,
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookDeliveryQuery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookEventType,
  WebhookPayload,
  WebhookSubscription,
  XapiStatementStoredEventData,
} from './webhooks.js';

export { CertificatesClient } from './certificates.js';
export type {
  Certificate,
  CertificateEventData,
  CertificateList,
  CertificatePdfUrlOptions,
  CertificateQuery,
  CertificateStatus,
  CertificateVerification,
  IssueCertificateResult,
} from './certificates.js';

export { EventsClient, parseSse } from './events.js';
export type {
  EngineEventStream,
  EngineEventStreamOptions,
  EngineEventStreamStatus,
  SseMessage,
} from './events.js';

export { PluginsClient, isPluginMissing } from './plugins.js';
export type { ActivityBucket, ActivityQuery, ActivityReport, EventCounts, InstalledPlugin } from './plugins.js';

export { AiClient, AI_FEATURES, AI_PROVIDERS, isAiUnavailable } from './ai.js';
export type {
  AiBudgetAlertEventData,
  AiCall,
  AiCallList,
  AiCallQuery,
  AiCallStatus,
  AiFeature,
  AiInsight,
  AiInsightKind,
  AiInsightRequest,
  AiProvider,
  AiProviderConfig,
  AiProviderConfigInput,
  AiProviderTestRequest,
  AiProviderTestResult,
  AiUsage,
  AiUsageReport,
  PiiKind,
  SetAiProviderResult,
} from './ai.js';

export { ReplayClient, ReplayRecorder, REPLAY_EVENT_TYPES, isReplayCaptureDisabled } from './replay.js';
export type {
  AttemptReplay,
  CourseHeatmap,
  EngagementLevel,
  EngagementScore,
  HeatmapCell,
  HeatmapLocation,
  HeatmapQuery,
  RecordOptions,
  ReplayEvent,
  ReplayEventsResult,
  ReplayEventType,
  ReplayLocationVisit,
  ReplayRecorderOptions,
  ReplaySource,
  ReplayTimelineEntry,
} from './replay.js';

export { ScormClient, createScormClient } from './client.js';
export type {
  ScormClientOptions,
  RequestOptions,
  CoursesApi,
  AttemptsApi,
  AnalyticsApi,
} from './client.js';

export { RestTransport } from './transports/rest.js';
export type {
  RestTransportOptions,
  StartAttemptRequest,
  StartAttemptResult,
  SyncCommit,
  SyncCommitOutcome,
  SyncCommitStatus,
  SyncResult,
} from './transports/rest.js';

export { OfflineTransport, isOfflineError } from './transports/offline.js';
export type {
  FlushResult,
  OfflineTransportOptions,
  SyncCapableTransport,
} from './transports/offline.js';
