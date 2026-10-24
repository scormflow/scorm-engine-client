/**
 * React bindings for the engine's analytics read models: the tenant overview,
 * learner rollups, daily trends and course score distributions. Reading needs
 * a client with the API key — these back admin dashboards, not learner views.
 */
import type {
  AnalyticsOverview,
  AnalyticsTrends,
  LearnerAnalytics,
  ResourceClient,
  ScoreDistribution,
  TrendsQuery,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** Tenant-wide counts, completion rate and average score. */
export function useAnalyticsOverview(resources: ResourceClient): AsyncResource<AnalyticsOverview> {
  return useAsyncResource<AnalyticsOverview>('analytics-overview', (signal) => resources.getOverview({ signal }), true);
}

/** One learner's rollup, keyed by the host LMS's learner id. Idle while `learnerId` is falsy. */
export function useLearnerAnalytics(
  resources: ResourceClient,
  learnerId: string | null | undefined,
): AsyncResource<LearnerAnalytics> {
  return useAsyncResource<LearnerAnalytics>(
    `learner-analytics:${learnerId ?? ''}`,
    (signal) => resources.getLearnerAnalytics(learnerId as string, { signal }),
    Boolean(learnerId),
  );
}

/** Daily started / completed / passed / failed series, tenant-wide or for `query.courseId`. */
export function useAnalyticsTrends(resources: ResourceClient, query: TrendsQuery = {}): AsyncResource<AnalyticsTrends> {
  return useAsyncResource<AnalyticsTrends>(
    `analytics-trends:${query.days ?? ''}:${query.courseId ?? ''}`,
    (signal) => resources.getTrends(query, { signal }),
    true,
  );
}

/** A course's scaled-score histogram. Idle while `courseId` is falsy. */
export function useScoreDistribution(
  resources: ResourceClient,
  courseId: string | null | undefined,
  bins?: number,
): AsyncResource<ScoreDistribution> {
  return useAsyncResource<ScoreDistribution>(
    `score-distribution:${courseId ?? ''}:${bins ?? ''}`,
    (signal) => resources.getScoreDistribution(courseId as string, bins === undefined ? {} : { bins }, { signal }),
    Boolean(courseId),
  );
}
