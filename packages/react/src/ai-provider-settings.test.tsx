import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiClient, ScormClient, type AiProviderConfig } from '@scormflow/sdk';

import {
  AiProviderSettings,
  AiProviderTestResultView,
  aiProviderFormFrom,
  describeAiBudget,
  emptyAiProviderForm,
  parseAiProviderForm,
  useAiProviderEditor,
  type AiProviderForm,
} from './ai-provider-settings.js';
import { ScormProvider } from './scorm-context.js';

// SSR runs no effects, so nothing is fetched; form logic is tested through
// the pure helpers the component is built on.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const ai = new AiClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const STORED: AiProviderConfig = {
  feature: 'default',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  baseUrl: null,
  hasKey: true,
  keyHint: '…9876',
  redactPii: true,
  enabled: true,
  monthlyTokenCap: 2_000_000,
  alertThreshold: 0.75,
  inputCostPerMTok: 3,
  outputCostPerMTok: 15,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

const form = (overrides: Partial<AiProviderForm> = {}): AiProviderForm => ({
  ...emptyAiProviderForm('openai'),
  model: 'gpt-test',
  apiKey: 'sk-new',
  ...overrides,
});

describe('parseAiProviderForm', () => {
  it('turns a filled form into the engine input', () => {
    expect(
      parseAiProviderForm(
        form({ monthlyTokenCap: ' 500000 ', alertPercent: '90', inputCostPerMTok: '2.5', outputCostPerMTok: '', redactPii: false }),
      ),
    ).toEqual({
      ok: true,
      input: {
        provider: 'openai',
        model: 'gpt-test',
        apiKey: 'sk-new',
        baseUrl: null,
        redactPii: false,
        enabled: true,
        monthlyTokenCap: 500000,
        alertThreshold: 0.9,
        inputCostPerMTok: 2.5,
        outputCostPerMTok: null,
      },
    });
  });

  it('keeps the stored key when the field is blank and the provider is unchanged', () => {
    const result = parseAiProviderForm(aiProviderFormFrom(STORED), STORED);
    expect(result.ok).toBe(true);
    expect(result.ok && 'apiKey' in result.input).toBe(false);
  });

  it('needs a new key when switching to another keyed provider', () => {
    const result = parseAiProviderForm({ ...aiProviderFormFrom(STORED), provider: 'openai' }, STORED);
    expect(result).toEqual({ ok: false, error: 'OpenAI needs an API key.' });
  });

  it('sends null to remove a key, but not for providers that need one', () => {
    const ollama = parseAiProviderForm(form({ provider: 'ollama', apiKey: '', removeKey: true }), { ...STORED, provider: 'ollama' });
    expect(ollama.ok && ollama.input.apiKey).toBeNull();
    expect(parseAiProviderForm({ ...aiProviderFormFrom(STORED), removeKey: true }, STORED).ok).toBe(false);
  });

  it('rejects bad input with a readable message', () => {
    const err = (f: AiProviderForm) => {
      const r = parseAiProviderForm(f);
      return r.ok ? null : r.error;
    };
    expect(err(form({ model: '  ' }))).toMatch(/model name/);
    expect(err(form({ provider: 'openai_compatible', apiKey: '' }))).toMatch(/needs a base URL/);
    expect(err(form({ provider: 'azure_openai', apiKey: 'k' }))).toMatch(/Azure OpenAI needs a base URL.*openai\.azure\.com/);
    expect(err(form({ provider: 'bedrock', apiKey: 'k' }))).toMatch(/AWS Bedrock needs a base URL.*bedrock-runtime/);
    expect(err(form({ provider: 'custom_http', apiKey: '' }))).toMatch(/needs a base URL/);
    expect(err(form({ provider: 'groq', apiKey: '' }))).toMatch(/Groq needs an API key/);
    expect(
      err(form({ provider: 'bedrock', apiKey: '', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com' })),
    ).toMatch(/AWS Bedrock needs an API key/);
    // custom_http works without a key; together has a default base URL.
    expect(err(form({ provider: 'custom_http', apiKey: '', baseUrl: 'https://ai.example.com/complete' }))).toBeNull();
    expect(err(form({ provider: 'together', apiKey: 'tk' }))).toBeNull();
    expect(err(form({ baseUrl: 'ftp://x' }))).toMatch(/http/);
    expect(err(form({ monthlyTokenCap: '1.5' }))).toMatch(/whole number/);
    expect(err(form({ monthlyTokenCap: 'lots' }))).toMatch(/whole number/);
    expect(err(form({ alertPercent: '0' }))).toMatch(/between 1 and 100/);
    expect(err(form({ alertPercent: '' }))).toMatch(/between 1 and 100/);
    expect(err(form({ outputCostPerMTok: '-1' }))).toMatch(/non-negative/);
    expect(err(form({ provider: 'ollama', apiKey: '' }))).toBeNull();
  });
});

describe('aiProviderFormFrom', () => {
  it('fills the form from a stored config without the key', () => {
    expect(aiProviderFormFrom(STORED)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      apiKey: '',
      removeKey: false,
      baseUrl: '',
      monthlyTokenCap: '2000000',
      alertPercent: '75',
      inputCostPerMTok: '3',
      outputCostPerMTok: '15',
      redactPii: true,
      enabled: true,
    });
  });
});

describe('describeAiBudget', () => {
  it('shows use against the cap', () => {
    expect(describeAiBudget({ tokensUsed: 1_234_567, monthlyTokenCap: 2_000_000 })).toBe('1.2M / 2M tokens (62%)');
    expect(describeAiBudget({ tokensUsed: 950, monthlyTokenCap: null })).toBe('950 tokens');
    expect(describeAiBudget({ tokensUsed: 12_500, monthlyTokenCap: null })).toBe('12.5k tokens');
  });
});

describe('<AiProviderSettings/>', () => {
  it('renders a row per feature and no form until one is opened', () => {
    const html = renderToStaticMarkup(<AiProviderSettings client={ai} />);
    expect(html).toContain('AI providers');
    for (const f of ['default', 'insights', 'summary', 'recommendations']) expect(html).toContain(`data-scormflow-ai-feature="${f}"`);
    expect(html).toContain('Not configured');
    expect(html).toContain('Uses the default');
    expect(html).not.toContain('<form');
  });

  it('can be limited to some features and takes the client from <ScormProvider>', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <AiProviderSettings features={['default']} title="Bring your own AI" />
      </ScormProvider>,
    );
    expect(html).toContain('Bring your own AI');
    expect(html).not.toContain('data-scormflow-ai-feature="summary"');
  });

  it('throws without a client', () => {
    expect(() => renderToStaticMarkup(<AiProviderSettings />)).toThrow(/needs a `client` prop/);
  });

  it('useAiProviderEditor starts idle', () => {
    function Probe() {
      const { busy, error, testResult } = useAiProviderEditor(ai);
      return <span>{`${busy}:${error}:${testResult}`}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toContain('null:null:null');
  });
});

describe('<AiProviderTestResultView/>', () => {
  it('reports success with latency', () => {
    const html = renderToStaticMarkup(
      <AiProviderTestResultView result={{ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5', latencyMs: 412 }} />,
    );
    expect(html).toContain('Anthropic answered with claude-sonnet-5-5 in 412 ms.');
  });

  it('reports why the provider refused', () => {
    const html = renderToStaticMarkup(
      <AiProviderTestResultView
        result={{
          ok: false,
          provider: 'openai',
          model: 'gpt-test',
          latencyMs: 80,
          error: { code: 'ai_provider_auth', message: 'invalid api key' },
        }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('The AI provider rejected the API key. (invalid api key)');
  });
});
