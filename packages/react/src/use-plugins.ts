/**
 * React bindings for engine plugins: what is installed, and the analytics
 * plugin's live activity, refreshed on an interval for dashboards.
 */
import { useEffect } from 'react';
import type { ActivityReport, InstalledPlugin, PluginsClient, WebhookEventType } from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** The engine's installed plugins. */
export function usePlugins(plugins: PluginsClient): AsyncResource<InstalledPlugin[]> {
  return useAsyncResource<InstalledPlugin[]>('plugins', (signal) => plugins.list({ signal }));
}

export interface UseLiveActivityOptions {
  /** Window in minutes; the plugin's retention (60 unless configured) when omitted. */
  minutes?: number;
  /** Re-fetch every this many ms; `0` fetches once. Default 15 000. */
  refreshIntervalMs?: number;
  /** Idle while false. Default true. */
  enabled?: boolean;
}

/**
 * The tenant's per-minute event counts from the engine's `analytics` plugin,
 * re-fetched every `refreshIntervalMs`. `error` is a 404 `ScormHttpError`
 * (see `isPluginMissing`) when the engine runs without the plugin. Keeps the
 * previous report on screen while a refresh is in flight.
 */
export function useLiveActivity(
  plugins: PluginsClient,
  options: UseLiveActivityOptions = {},
): AsyncResource<ActivityReport> {
  const { minutes, refreshIntervalMs = 15_000, enabled = true } = options;
  const resource = useAsyncResource<ActivityReport>(
    `plugins:analytics:activity:${minutes ?? ''}`,
    (signal) => plugins.activity(minutes === undefined ? {} : { minutes }, { signal }),
    enabled,
  );

  const { refetch } = resource;
  useEffect(() => {
    if (!enabled || refreshIntervalMs <= 0) return;
    const timer = setInterval(refetch, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, refreshIntervalMs, refetch]);

  return resource;
}

/** The report's event types by count, busiest first (ties alphabetical), at most `limit`. */
export function topEventTypes(
  report: Pick<ActivityReport, 'totals'> | null | undefined,
  limit = 5,
): Array<{ type: WebhookEventType; count: number }> {
  if (!report) return [];
  return (Object.entries(report.totals) as Array<[WebhookEventType, number | undefined]>)
    .filter((entry): entry is [WebhookEventType, number] => (entry[1] ?? 0) > 0)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, Math.max(0, limit));
}
