/**
 * React bindings for AI analytics. Reads (configs, usage, the call log) are
 * ordinary resources; generating an insight spends the tenant's tokens, so
 * `useAiInsight` never runs on its own — call `generate()` from a button.
 * These calls need the API key: use them in admin tools, not learner pages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiCallList,
  AiCallQuery,
  AiClient,
  AiInsight,
  AiInsightRequest,
  AiProviderConfig,
  AiUsageReport,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** The tenant's AI provider configs. */
export function useAiProviders(ai: AiClient): AsyncResource<AiProviderConfig[]> {
  return useAsyncResource<AiProviderConfig[]>('ai:providers', (signal) => ai.providers({ signal }));
}

export interface UseAiUsageOptions {
  /** Re-fetch every this many ms; `0` (the default) fetches once. */
  refreshIntervalMs?: number;
}

/** This month's token usage, cost and cap status per config. */
export function useAiUsage(ai: AiClient, options: UseAiUsageOptions = {}): AsyncResource<AiUsageReport> {
  const { refreshIntervalMs = 0 } = options;
  const resource = useAsyncResource<AiUsageReport>('ai:usage', (signal) => ai.usage({ signal }));
  const { refetch } = resource;
  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const timer = setInterval(refetch, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [refreshIntervalMs, refetch]);
  return resource;
}

/** One page of the AI call log; pass `pagination.nextCursor` back as `query.before`. */
export function useAiCalls(ai: AiClient, query: AiCallQuery = {}): AsyncResource<AiCallList> {
  return useAsyncResource<AiCallList>(`ai:calls:${query.limit ?? ''}:${query.before ?? ''}`, (signal) =>
    ai.calls(query, { signal }),
  );
}

export interface AiInsightState {
  /** The latest answer, kept while a new one is generated. */
  insight: AiInsight | null;
  /** Why the last `generate` failed — a `ScormHttpError` whose `code` names the reason. */
  error: unknown;
  loading: boolean;
  /** Ask the model. Cancels a generation still in flight; resolves with the answer, or null if it failed or was superseded. */
  generate: (request?: AiInsightRequest) => Promise<AiInsight | null>;
  /** Cancel anything in flight and clear the answer and error. */
  reset: () => void;
}

/** On-demand AI insight generation. Nothing is requested until `generate` is called. */
export function useAiInsight(ai: AiClient): AiInsightState {
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const generate = useCallback(
    async (request: AiInsightRequest = {}): Promise<AiInsight | null> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      setError(null);
      try {
        const result = await ai.generate(request, { signal: controller.signal });
        if (controller.signal.aborted) return null;
        setInsight(result);
        return result;
      } catch (err) {
        if (controller.signal.aborted) return null;
        setError(err);
        return null;
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [ai],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setInsight(null);
    setError(null);
    setLoading(false);
  }, []);

  return { insight, error, loading, generate, reset };
}

/** A short, human message for an AI error's `code`. */
export function describeAiError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'ai_not_configured':
      return 'No AI provider is configured yet.';
    case 'ai_disabled':
      return 'AI is switched off for this feature.';
    case 'ai_budget_exceeded':
      return 'This month’s AI token budget is used up.';
    case 'ai_provider_auth':
      return 'The AI provider rejected the API key.';
    case 'ai_provider_unreachable':
      return 'The AI provider could not be reached.';
    case 'ai_provider_error':
      return 'The AI provider returned an error.';
    case 'course_not_found':
      return 'Course not found.';
    default:
      return error instanceof Error && error.message ? error.message : 'Something went wrong.';
  }
}
