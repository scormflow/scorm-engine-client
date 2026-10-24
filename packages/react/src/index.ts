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
  useAiClient,
  useReplayClient,
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
export {
  useAnalyticsOverview,
  useAnalyticsTrends,
  useLearnerAnalytics,
  useScoreDistribution,
} from './use-analytics.js';
export {
  AnalyticsDashboard,
  AnalyticsOverviewCard,
  AnalyticsOverviewView,
  AnalyticsTrendChart,
  AnalyticsTrendChartView,
  CourseAnalyticsCard,
  CourseAnalyticsView,
  ScoreDistributionChart,
  ScoreDistributionView,
  StatTile,
  formatDuration,
  formatPercent,
  formatTrendDate,
  niceScale,
} from './analytics-widgets.js';
export type {
  AnalyticsDashboardProps,
  AnalyticsOverviewCardProps,
  AnalyticsOverviewViewProps,
  AnalyticsTrendChartProps,
  AnalyticsTrendChartViewProps,
  CourseAnalyticsCardProps,
  CourseAnalyticsViewProps,
  ScoreDistributionChartProps,
  ScoreDistributionViewProps,
  StatTileProps,
} from './analytics-widgets.js';
export { useScormUpload } from './use-scorm-upload.js';
export type { UseScormUploadResult, UploadStatus } from './use-scorm-upload.js';
export { usePackageValidation } from './use-package-validation.js';
export type { UsePackageValidationResult, ValidationStatus } from './use-package-validation.js';
export {
  describeValidation,
  groupValidationIssues,
  PackageValidationView,
  PackageValidator,
  VALIDATION_CATEGORY_LABELS,
} from './package-validation.js';
export type { PackageValidationViewProps, PackageValidatorProps } from './package-validation.js';
export { useCourseVersionDiff, useCourseVersions } from './use-course-versions.js';
export type { CourseVersionAction, UseCourseVersionsResult } from './use-course-versions.js';
export {
  CourseVersionDiffView,
  CourseVersionHistory,
  describeVersionDiff,
  formatVersionDate,
} from './course-versions.js';
export type { CourseVersionDiffViewProps, CourseVersionHistoryProps } from './course-versions.js';

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
export { describeAiError, useAiCalls, useAiInsight, useAiProviders, useAiUsage } from './use-ai.js';
export type { AiInsightState, UseAiUsageOptions } from './use-ai.js';
export { AiInsightPanel, AiInsightView, describeAiInsight } from './ai-insight-panel.js';
export type { AiInsightPanelProps, AiInsightViewProps } from './ai-insight-panel.js';
export {
  AI_FEATURE_LABELS,
  AI_PROVIDER_LABELS,
  AiProviderSettings,
  AiProviderTestResultView,
  aiProviderFormFrom,
  aiProviderNeedsBaseUrl,
  aiProviderNeedsKey,
  describeAiBudget,
  emptyAiProviderForm,
  parseAiProviderForm,
  useAiProviderEditor,
} from './ai-provider-settings.js';
export type {
  AiProviderEditor,
  AiProviderForm,
  AiProviderSettingsProps,
  ParsedAiProviderForm,
} from './ai-provider-settings.js';
export {
  lastIndexAtOrBefore,
  locationAt,
  useCourseHeatmap,
  useReplayPlayback,
  useSessionReplay,
} from './use-replay.js';
export type { ReplayPlayback, ReplayPlaybackOptions } from './use-replay.js';
export { SessionReplay, SessionReplayView, describeReplayEntry, formatReplayTime } from './session-replay.js';
export type { SessionReplayProps, SessionReplayViewProps } from './session-replay.js';
export { CourseHeatmap, CourseHeatmapView, PointerGrid } from './course-heatmap.js';
export type { CourseHeatmapProps, CourseHeatmapViewProps } from './course-heatmap.js';
