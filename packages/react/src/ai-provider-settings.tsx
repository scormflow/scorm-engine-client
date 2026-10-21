import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AI_FEATURES,
  AI_PROVIDERS,
  AI_PROVIDERS_NEEDING_BASE_URL,
  AI_PROVIDERS_NEEDING_KEY,
  type AiClient,
  type AiFeature,
  type AiProvider,
  type AiProviderConfig,
  type AiProviderConfigInput,
  type AiProviderTestResult,
  type AiUsage,
} from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { describeAiError, useAiProviders, useAiUsage } from './use-ai.js';

/**
 * Tenant AI settings: which provider and model answer each feature, its key
 * (write-only — only the hint is ever shown), budget and kill-switch, with a
 * "Test key" that checks a key without storing it. Needs the API key: use it
 * in admin tools, never a learner page.
 */

/** Editable form state: every field as the input holds it. */
export interface AiProviderForm {
  provider: AiProvider;
  model: string;
  /** Blank keeps the stored key (same provider only). */
  apiKey: string;
  /** Tick to delete the stored key. */
  removeKey: boolean;
  baseUrl: string;
  monthlyTokenCap: string;
  /** Percent of the cap, `1`–`100`. */
  alertPercent: string;
  inputCostPerMTok: string;
  outputCostPerMTok: string;
  redactPii: boolean;
  enabled: boolean;
}

export type ParsedAiProviderForm = { ok: true; input: AiProviderConfigInput } | { ok: false; error: string };

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  mistral: 'Mistral',
  ollama: 'Ollama (local)',
  openai_compatible: 'OpenAI-compatible',
  groq: 'Groq',
  together: 'Together AI',
  azure_openai: 'Azure OpenAI',
  bedrock: 'AWS Bedrock',
  custom_http: 'Custom HTTP endpoint',
};

/** Example base URLs for the providers that need one. */
const BASE_URL_HINTS: Partial<Record<AiProvider, string>> = {
  openai_compatible: 'https://llm.example.com/v1',
  azure_openai: 'https://<resource>.openai.azure.com',
  bedrock: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  custom_http: 'https://ai.example.com/complete',
};

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  default: 'Default',
  insights: 'Insights',
  summary: 'Summaries',
  recommendations: 'Recommendations',
};

export function aiProviderNeedsKey(provider: AiProvider): boolean {
  return AI_PROVIDERS_NEEDING_KEY.includes(provider);
}

export function aiProviderNeedsBaseUrl(provider: AiProvider): boolean {
  return AI_PROVIDERS_NEEDING_BASE_URL.includes(provider);
}

export function emptyAiProviderForm(provider: AiProvider = 'openai'): AiProviderForm {
  return {
    provider,
    model: '',
    apiKey: '',
    removeKey: false,
    baseUrl: '',
    monthlyTokenCap: '',
    alertPercent: '80',
    inputCostPerMTok: '',
    outputCostPerMTok: '',
    redactPii: true,
    enabled: true,
  };
}

/** The form for editing a stored config. The key itself is never known — `apiKey` starts blank. */
export function aiProviderFormFrom(config: AiProviderConfig): AiProviderForm {
  const num = (n: number | null) => (n == null ? '' : String(n));
  return {
    provider: config.provider,
    model: config.model,
    apiKey: '',
    removeKey: false,
    baseUrl: config.baseUrl ?? '',
    monthlyTokenCap: num(config.monthlyTokenCap),
    alertPercent: String(Math.round(config.alertThreshold * 100)),
    inputCostPerMTok: num(config.inputCostPerMTok),
    outputCostPerMTok: num(config.outputCostPerMTok),
    redactPii: config.redactPii,
    enabled: config.enabled,
  };
}

/**
 * Validate the form and turn it into the engine's input. `stored` is the
 * config being edited, if any: a blank key keeps its key only when the
 * provider is unchanged (the engine drops a key that belongs to another
 * provider).
 */
export function parseAiProviderForm(form: AiProviderForm, stored?: AiProviderConfig | null): ParsedAiProviderForm {
  const model = form.model.trim();
  if (!model) return { ok: false, error: 'Enter a model name.' };

  const baseUrl = form.baseUrl.trim();
  if (baseUrl && !/^https?:\/\/\S+$/i.test(baseUrl)) return { ok: false, error: 'Base URL must start with http:// or https://.' };
  if (aiProviderNeedsBaseUrl(form.provider) && !baseUrl) {
    return { ok: false, error: `${AI_PROVIDER_LABELS[form.provider]} needs a base URL (e.g. ${BASE_URL_HINTS[form.provider]}).` };
  }

  const apiKey = form.apiKey.trim();
  const keepsStoredKey = !form.removeKey && !apiKey && stored?.hasKey === true && stored.provider === form.provider;
  if (aiProviderNeedsKey(form.provider) && !apiKey && !keepsStoredKey) {
    return { ok: false, error: `${AI_PROVIDER_LABELS[form.provider]} needs an API key.` };
  }

  const cap = optionalNumber(form.monthlyTokenCap);
  if (cap === undefined || (cap !== null && (!Number.isInteger(cap) || cap < 1))) {
    return { ok: false, error: 'Monthly token cap must be a whole number of at least 1, or blank for none.' };
  }
  const alert = optionalNumber(form.alertPercent);
  if (alert === undefined || alert === null || alert < 1 || alert > 100) {
    return { ok: false, error: 'Alert threshold must be between 1 and 100 percent.' };
  }
  const inputCost = optionalNumber(form.inputCostPerMTok);
  const outputCost = optionalNumber(form.outputCostPerMTok);
  if (inputCost === undefined || outputCost === undefined || (inputCost ?? 0) < 0 || (outputCost ?? 0) < 0) {
    return { ok: false, error: 'Costs must be non-negative numbers, or blank.' };
  }

  const input: AiProviderConfigInput = {
    provider: form.provider,
    model,
    baseUrl: baseUrl || null,
    redactPii: form.redactPii,
    enabled: form.enabled,
    monthlyTokenCap: cap,
    alertThreshold: alert / 100,
    inputCostPerMTok: inputCost,
    outputCostPerMTok: outputCost,
  };
  if (apiKey) input.apiKey = apiKey;
  else if (form.removeKey) input.apiKey = null;
  return { ok: true, input };
}

/** Blank → null, a number → the number, anything else → undefined (invalid). */
function optionalNumber(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** "1.2M / 2M tokens (60%)", or "1.2M tokens" without a cap. */
export function describeAiBudget(usage: Pick<AiUsage, 'tokensUsed' | 'monthlyTokenCap'>): string {
  const used = compact(usage.tokensUsed);
  if (usage.monthlyTokenCap == null) return `${used} tokens`;
  const pct = usage.monthlyTokenCap > 0 ? Math.round((usage.tokensUsed / usage.monthlyTokenCap) * 100) : 0;
  return `${used} / ${compact(usage.monthlyTokenCap)} tokens (${pct}%)`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

export interface AiProviderEditor {
  /** The feature an action is running for, if any. */
  busy: AiFeature | 'test' | null;
  error: unknown;
  testResult: AiProviderTestResult | null;
  save: (feature: AiFeature, input: AiProviderConfigInput) => Promise<AiProviderConfig | null>;
  remove: (feature: AiFeature) => Promise<boolean>;
  test: (input: AiProviderConfigInput) => Promise<AiProviderTestResult | null>;
  clear: () => void;
}

/** Save / remove / test actions for AI provider configs; `onChange` runs after a save or remove. */
export function useAiProviderEditor(ai: AiClient, onChange?: () => void): AiProviderEditor {
  const [busy, setBusy] = useState<AiProviderEditor['busy']>(null);
  const [error, setError] = useState<unknown>(null);
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const run = useCallback(async <T,>(tag: AiProviderEditor['busy'], fn: () => Promise<T>): Promise<T | null> => {
    setBusy(tag);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      if (mounted.current) setError(err);
      return null;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);

  const save = useCallback(
    async (feature: AiFeature, input: AiProviderConfigInput) => {
      const result = await run(feature, () => ai.setProvider(feature, input));
      if (result) onChange?.();
      return result?.config ?? null;
    },
    [ai, run, onChange],
  );

  const remove = useCallback(
    async (feature: AiFeature) => {
      const done = await run(feature, async () => {
        await ai.deleteProvider(feature);
        return true;
      });
      if (done) onChange?.();
      return done === true;
    },
    [ai, run, onChange],
  );

  const test = useCallback(
    async (input: AiProviderConfigInput) => {
      setTestResult(null);
      const result = await run('test', () =>
        ai.testProvider({
          provider: input.provider,
          model: input.model,
          ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        }),
      );
      if (mounted.current) setTestResult(result);
      return result;
    },
    [ai, run],
  );

  const clear = useCallback(() => {
    setError(null);
    setTestResult(null);
  }, []);

  return { busy, error, testResult, save, remove, test, clear };
}

export interface AiProviderSettingsProps {
  /** Defaults to the `<ScormProvider>` client's `ai`. */
  client?: AiClient;
  /** Features to manage. Default: all of them. */
  features?: readonly AiFeature[];
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  /** Called after a config is saved or removed. */
  onChange?: (feature: AiFeature, config: AiProviderConfig | null) => void;
}

const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #e5e7eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
  fontSize: '0.875rem',
};
const titleStyle: CSSProperties = { margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const cellStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  textAlign: 'left',
  borderBottom: '1px solid var(--scormflow-border, #e5e7eb)',
  verticalAlign: 'middle',
};
const mutedStyle: CSSProperties = { color: 'var(--scormflow-muted, #666)' };
const formStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
  gap: '0.75rem',
  marginTop: '1rem',
};
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const checkStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.4rem' };
const inputStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.3rem 0.5rem',
  border: '1px solid var(--scormflow-border, #d1d5db)',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
  background: 'var(--scormflow-bg, #ffffff)',
  color: 'inherit',
};
const actionsStyle: CSSProperties = { gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', alignItems: 'center' };
const buttonStyle: CSSProperties = {
  padding: '0.35rem 0.85rem',
  font: 'inherit',
  fontSize: '0.8125rem',
  cursor: 'pointer',
  color: 'var(--scormflow-button-fg, #fff)',
  background: 'var(--scormflow-accent, #2563eb)',
  border: 'none',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
};
const secondaryStyle: CSSProperties = {
  ...buttonStyle,
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'transparent',
  border: '1px solid var(--scormflow-border, #d1d5db)',
};
const dangerStyle: CSSProperties = { ...secondaryStyle, color: 'var(--scormflow-danger, #b91c1c)' };
const errorStyle: CSSProperties = { margin: '0.75rem 0 0', color: 'var(--scormflow-danger, #b91c1c)' };
const okStyle: CSSProperties = { margin: '0.75rem 0 0', color: 'var(--scormflow-success, #15803d)' };

/**
 * Manage the tenant's AI provider configs: one row per feature with its
 * provider, model, key hint, budget use and status, and a form to add, edit,
 * test or remove a config.
 */
export function AiProviderSettings({
  client,
  features = AI_FEATURES,
  className,
  style,
  title = 'AI providers',
  onChange,
}: AiProviderSettingsProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const ai = client ?? fromContext?.ai;
  if (!ai) throw new Error('<AiProviderSettings> needs a `client` prop or a <ScormProvider>.');

  const providers = useAiProviders(ai);
  const usage = useAiUsage(ai);
  const refetchAll = useCallback(() => {
    providers.refetch();
    usage.refetch();
  }, [providers.refetch, usage.refetch]);
  const editor = useAiProviderEditor(ai, refetchAll);

  const [editing, setEditing] = useState<AiFeature | null>(null);
  const [form, setForm] = useState<AiProviderForm>(() => emptyAiProviderForm());
  const [formError, setFormError] = useState<string | null>(null);

  const configs = new Map((providers.data ?? []).map((c) => [c.feature, c]));
  const usageOf = new Map((usage.data?.data ?? []).map((u) => [u.feature, u]));
  const stored = editing ? (configs.get(editing) ?? null) : null;

  const open = (feature: AiFeature) => {
    const config = configs.get(feature);
    setEditing(feature);
    setForm(config ? aiProviderFormFrom(config) : emptyAiProviderForm());
    setFormError(null);
    editor.clear();
  };
  const close = () => {
    setEditing(null);
    setFormError(null);
    editor.clear();
  };
  const set = <K extends keyof AiProviderForm>(key: K, value: AiProviderForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const parsed = () => {
    const result = parseAiProviderForm(form, stored);
    setFormError(result.ok ? null : result.error);
    return result.ok ? result.input : null;
  };
  const onSave = async () => {
    const input = parsed();
    if (!editing || !input) return;
    const config = await editor.save(editing, input);
    if (config) {
      onChange?.(editing, config);
      close();
    }
  };
  const onTest = async () => {
    const input = parsed();
    if (!input) return;
    if (input.apiKey === undefined && aiProviderNeedsKey(input.provider)) {
      setFormError('Enter the key to test it — stored keys are never sent back to the browser.');
      return;
    }
    await editor.test(input);
  };
  const onRemove = async () => {
    if (!editing) return;
    if (await editor.remove(editing)) {
      onChange?.(editing, null);
      close();
    }
  };

  const loadError = providers.error ?? null;
  const busy = editor.busy !== null;
  const fieldId = (name: string) => `scormflow-ai-${editing ?? 'new'}-${name}`;

  return (
    <section className={className} style={{ ...panelStyle, ...style }} aria-busy={providers.loading || busy}>
      <h3 style={titleStyle}>{title}</h3>
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {describeAiError(loadError)}
        </p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={cellStyle}>Feature</th>
              <th style={cellStyle}>Provider</th>
              <th style={cellStyle}>Model</th>
              <th style={cellStyle}>Key</th>
              <th style={cellStyle}>This month</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle} />
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => {
              const config = configs.get(feature);
              const used = usageOf.get(feature);
              return (
                <tr key={feature} data-scormflow-ai-feature={feature}>
                  <td style={cellStyle}>{AI_FEATURE_LABELS[feature]}</td>
                  {config ? (
                    <>
                      <td style={cellStyle}>{AI_PROVIDER_LABELS[config.provider]}</td>
                      <td style={cellStyle}>{config.model}</td>
                      <td style={cellStyle}>{config.hasKey ? (config.keyHint ?? 'stored') : <span style={mutedStyle}>none</span>}</td>
                      <td style={cellStyle}>
                        {used ? describeAiBudget(used) : config.monthlyTokenCap != null ? describeAiBudget({ tokensUsed: 0, monthlyTokenCap: config.monthlyTokenCap }) : '—'}
                      </td>
                      <td style={cellStyle}>{statusOf(config, used)}</td>
                    </>
                  ) : (
                    <td style={{ ...cellStyle, ...mutedStyle }} colSpan={5}>
                      {feature === 'default' ? 'Not configured' : 'Uses the default'}
                    </td>
                  )}
                  <td style={{ ...cellStyle, textAlign: 'right' }}>
                    <button type="button" style={secondaryStyle} disabled={busy} onClick={() => open(feature)}>
                      {config ? 'Edit' : 'Set up'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editing ? (
        <form
          style={formStyle}
          aria-label={`${AI_FEATURE_LABELS[editing]} AI provider`}
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <label style={labelStyle} htmlFor={fieldId('provider')}>
            Provider
            <select
              id={fieldId('provider')}
              style={inputStyle}
              value={form.provider}
              onChange={(e) => set('provider', e.target.value as AiProvider)}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {AI_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle} htmlFor={fieldId('model')}>
            {form.provider === 'azure_openai' ? 'Deployment name' : 'Model'}
            <input id={fieldId('model')} style={inputStyle} value={form.model} onChange={(e) => set('model', e.target.value)} required />
          </label>
          <label style={labelStyle} htmlFor={fieldId('key')}>
            API key
            <input
              id={fieldId('key')}
              style={inputStyle}
              type="password"
              autoComplete="off"
              value={form.apiKey}
              placeholder={
                stored?.hasKey && stored.provider === form.provider
                  ? `Stored (${stored.keyHint ?? '…'}) — blank keeps it`
                  : form.provider === 'bedrock'
                    ? 'Bedrock API key, or ACCESS_KEY_ID:SECRET'
                    : ''
              }
              onChange={(e) => set('apiKey', e.target.value)}
            />
          </label>
          <label style={labelStyle} htmlFor={fieldId('base')}>
            Base URL{aiProviderNeedsBaseUrl(form.provider) ? '' : ' (optional)'}
            <input
              id={fieldId('base')}
              style={inputStyle}
              type="url"
              value={form.baseUrl}
              placeholder={BASE_URL_HINTS[form.provider] ?? ''}
              onChange={(e) => set('baseUrl', e.target.value)}
            />
          </label>
          <label style={labelStyle} htmlFor={fieldId('cap')}>
            Monthly token cap
            <input id={fieldId('cap')} style={inputStyle} inputMode="numeric" value={form.monthlyTokenCap} placeholder="No cap" onChange={(e) => set('monthlyTokenCap', e.target.value)} />
          </label>
          <label style={labelStyle} htmlFor={fieldId('alert')}>
            Alert at (% of cap)
            <input id={fieldId('alert')} style={inputStyle} inputMode="numeric" value={form.alertPercent} onChange={(e) => set('alertPercent', e.target.value)} />
          </label>
          <label style={labelStyle} htmlFor={fieldId('in-cost')}>
            Input $ / M tokens
            <input id={fieldId('in-cost')} style={inputStyle} inputMode="decimal" value={form.inputCostPerMTok} onChange={(e) => set('inputCostPerMTok', e.target.value)} />
          </label>
          <label style={labelStyle} htmlFor={fieldId('out-cost')}>
            Output $ / M tokens
            <input id={fieldId('out-cost')} style={inputStyle} inputMode="decimal" value={form.outputCostPerMTok} onChange={(e) => set('outputCostPerMTok', e.target.value)} />
          </label>
          <label style={checkStyle}>
            <input type="checkbox" checked={form.redactPii} onChange={(e) => set('redactPii', e.target.checked)} />
            Redact personal data before sending
          </label>
          <label style={checkStyle}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Enabled
          </label>
          {stored?.hasKey ? (
            <label style={checkStyle}>
              <input type="checkbox" checked={form.removeKey} onChange={(e) => set('removeKey', e.target.checked)} />
              Remove the stored key
            </label>
          ) : null}
          <div style={actionsStyle}>
            <button type="submit" style={buttonStyle} disabled={busy}>
              {editor.busy === editing ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={secondaryStyle} disabled={busy} onClick={() => void onTest()}>
              {editor.busy === 'test' ? 'Testing…' : 'Test key'}
            </button>
            <button type="button" style={secondaryStyle} disabled={busy} onClick={close}>
              Cancel
            </button>
            {stored ? (
              <button type="button" style={{ ...dangerStyle, marginLeft: 'auto' }} disabled={busy} onClick={() => void onRemove()}>
                Remove
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : editor.error ? (
        <p role="alert" style={errorStyle}>
          {describeAiError(editor.error)}
        </p>
      ) : null}
      {editor.testResult ? <AiProviderTestResultView result={editor.testResult} /> : null}
    </section>
  );
}

/** "Disabled", "Budget used up", "Near budget" or "Active". */
function statusOf(config: AiProviderConfig, usage: AiUsage | undefined): string {
  if (!config.enabled) return 'Disabled';
  if (usage?.exhausted) return 'Budget used up';
  if (usage?.alerting) return 'Near budget';
  return 'Active';
}

/** The outcome of a "Test key": latency on success, the provider's complaint otherwise. */
export function AiProviderTestResultView({ result }: { result: AiProviderTestResult }): JSX.Element {
  if (result.ok) {
    return (
      <p role="status" style={okStyle}>
        {`${AI_PROVIDER_LABELS[result.provider]} answered with ${result.model} in ${result.latencyMs} ms.`}
      </p>
    );
  }
  return (
    <p role="alert" style={errorStyle}>
      {`${describeAiError(result.error ?? null)}${result.error?.message ? ` (${result.error.message})` : ''}`}
    </p>
  );
}
