/**
 * AI analytics against the `/ai` REST surface — bring your own provider + key.
 *
 * The engine mounts these routes only when it runs with `AI_MASTER_KEY`;
 * without it every call rejects with a 404 {@link ScormHttpError} (see
 * {@link isAiUnavailable}). Every call needs the API key, so use this from a
 * server or an admin tool, never a learner's browser.
 *
 * Provider keys are write-only: `setProvider` sends one, and responses only
 * ever carry `keyHint` (its last four characters).
 */
import { ScormHttpError } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'ollama' | 'openai_compatible';

/** What can be asked for. */
export type AiInsightKind = 'insights' | 'summary' | 'recommendations';

/** A config serves one kind, or `default` for every kind without its own. */
export type AiFeature = 'default' | AiInsightKind;

export const AI_PROVIDERS: readonly AiProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'mistral',
  'ollama',
  'openai_compatible',
];

export const AI_FEATURES: readonly AiFeature[] = ['default', 'insights', 'summary', 'recommendations'];

export interface AiProviderConfig {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  /** The stored key's last four characters, e.g. `…9f3a`. */
  keyHint: string | null;
  redactPii: boolean;
  /** Kill-switch: when false the engine refuses calls with 409 `ai_disabled`. */
  enabled: boolean;
  /** Input + output tokens per calendar month (UTC); null for no cap. */
  monthlyTokenCap: number | null;
  /** Fraction of the cap at which `ai.budget.alert` fires. */
  alertThreshold: number;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderConfigInput {
  provider: AiProvider;
  model: string;
  /** Required for openai, anthropic, gemini, mistral. Omit to keep the stored key; `null` removes it. */
  apiKey?: string | null;
  /** Required for `openai_compatible`; overrides the provider's API base otherwise. */
  baseUrl?: string | null;
  redactPii?: boolean;
  enabled?: boolean;
  monthlyTokenCap?: number | null;
  alertThreshold?: number;
  /** USD per million input tokens, so the engine can report cost. */
  inputCostPerMTok?: number | null;
  outputCostPerMTok?: number | null;
}

export interface SetAiProviderResult {
  config: AiProviderConfig;
  /** True when this call created the config, false when it replaced one. */
  created: boolean;
}

export interface AiProviderTestRequest {
  provider: AiProvider;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export interface AiProviderTestResult {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  error?: { code: 'ai_provider_auth' | 'ai_provider_error' | 'ai_provider_unreachable'; message: string };
}

export interface AiInsightRequest {
  /** Default `insights`. */
  kind?: AiInsightKind;
  /** One course; omit for the whole tenant. */
  courseId?: string;
  /** An extra question for the model (at most 500 characters). */
  question?: string;
}

export type PiiKind = 'email' | 'card' | 'ssn' | 'ip' | 'phone';

export interface AiInsight {
  /** The call-log entry for this answer. */
  id: string;
  kind: AiInsightKind;
  scope: 'course' | 'tenant';
  courseId: string | null;
  /** The config that answered (`default` when the kind has none of its own). */
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  /** The model's answer, in Markdown. */
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number | null };
  redactions: { count: number; counts: Partial<Record<PiiKind, number>> };
  sample: { attempts: number; truncated: boolean; from: string | null; to: string | null };
  generatedAt: string;
}

export interface AiUsage {
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  calls: number;
  tokensUsed: number;
  costUsd: number | null;
  monthlyTokenCap: number | null;
  alertThreshold: number;
  alerting: boolean;
  exhausted: boolean;
}

export interface AiUsageReport {
  /** `YYYY-MM` (UTC). */
  month: string;
  data: AiUsage[];
}

export type AiCallStatus = 'succeeded' | 'failed' | 'blocked';

export interface AiCall {
  id: string;
  feature: string;
  kind: string;
  provider: string;
  model: string;
  courseId: string | null;
  status: AiCallStatus;
  /** SHA-256 of the prompt as sent. The prompt itself is not stored. */
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  redactions: number;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

export interface AiCallList {
  data: AiCall[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

export interface AiCallQuery {
  /** 1–1000, default 50. */
  limit?: number;
  /** The previous page's `pagination.nextCursor`. */
  before?: string;
}

/** `data` of an `ai.budget.alert` event. */
export interface AiBudgetAlertEventData {
  /** `threshold` when usage reached `alertThreshold` of the cap, `exhausted` at the cap. */
  level: 'threshold' | 'exhausted';
  feature: AiFeature;
  provider: AiProvider;
  model: string;
  tokensUsed: number;
  monthlyTokenCap: number;
  alertThreshold: number;
}

type Signal = { signal?: AbortSignal };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

/** Model calls can take a while; give them longer than ordinary requests. */
const INSIGHT_TIMEOUT_MS = 120_000;

export class AiClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** The tenant's provider configs. */
  async providers(options?: Signal): Promise<AiProviderConfig[]> {
    const res = await this.http.get<{ data: AiProviderConfig[] }>('ai/providers', sig(options));
    return res.data;
  }

  /** One config; rejects with a 404 when the feature has none. */
  provider(feature: AiFeature, options?: Signal): Promise<AiProviderConfig> {
    return this.http.get<AiProviderConfig>(`ai/providers/${enc(feature)}`, sig(options));
  }

  /** Create or replace the config for `feature`. */
  async setProvider(feature: AiFeature, input: AiProviderConfigInput, options?: Signal): Promise<SetAiProviderResult> {
    const res = await this.http.raw({ method: 'PUT', path: `ai/providers/${enc(feature)}`, json: input, ...sig(options) });
    return { config: (await res.json()) as AiProviderConfig, created: res.status === 201 };
  }

  async deleteProvider(feature: AiFeature, options?: Signal): Promise<void> {
    await this.http.delete<void>(`ai/providers/${enc(feature)}`, sig(options));
  }

  /**
   * Check a provider, model and key with a tiny completion, storing nothing.
   * Resolves with `ok: false` (and `error`) when the provider refuses; rejects
   * only for a malformed request. Not retried.
   */
  testProvider(input: AiProviderTestRequest, options?: Signal): Promise<AiProviderTestResult> {
    return this.http.post<AiProviderTestResult>('ai/providers/test', input, { retries: 0, ...sig(options) });
  }

  /**
   * Ask the configured model about the tenant's (or one course's) learning
   * data. Not retried — each call spends the tenant's tokens. Rejects with a
   * `ScormHttpError` whose `code` says why: `ai_not_configured` (404),
   * `course_not_found` (404), `ai_disabled` (409), `ai_budget_exceeded`
   * (429) or `ai_provider_*` (502).
   */
  generate(request: AiInsightRequest = {}, options?: Signal & { timeoutMs?: number }): Promise<AiInsight> {
    return this.http.post<AiInsight>('ai/insights', request, {
      retries: 0,
      timeoutMs: options?.timeoutMs ?? INSIGHT_TIMEOUT_MS,
      ...sig(options),
    });
  }

  /** This month's tokens, cost and cap status for each config. */
  usage(options?: Signal): Promise<AiUsageReport> {
    return this.http.get<AiUsageReport>('ai/usage', sig(options));
  }

  /** One page of the call audit log, newest first. */
  calls(query: AiCallQuery = {}, options?: Signal): Promise<AiCallList> {
    return this.http.get<AiCallList>('ai/calls', { query: { limit: query.limit, before: query.before }, ...sig(options) });
  }

  /** The same page as CSV text, for export. */
  async callsCsv(query: AiCallQuery = {}, options?: Signal): Promise<string> {
    const res = await this.http.raw({
      method: 'GET',
      path: 'ai/calls',
      query: { format: 'csv', limit: query.limit, before: query.before },
      headers: { accept: 'text/csv' },
      ...sig(options),
    });
    return res.text();
  }
}

/** 404 codes the AI routes answer with themselves — the routes exist. */
const AI_NOT_FOUND_CODES = new Set(['ai_not_configured', 'ai_config_not_found', 'course_not_found']);

/** True when the engine has no AI routes (it runs without `AI_MASTER_KEY`). */
export function isAiUnavailable(err: unknown): boolean {
  return err instanceof ScormHttpError && err.status === 404 && !AI_NOT_FOUND_CODES.has(err.code);
}
