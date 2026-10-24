import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiClient, ScormClient, ScormHttpError, type AiInsight } from '@scormflow/sdk';

import { AiInsightPanel, AiInsightView, describeAiInsight } from './ai-insight-panel.js';
import { ScormProvider, useAiClient } from './scorm-context.js';
import { describeAiError, useAiCalls, useAiInsight, useAiProviders, useAiUsage } from './use-ai.js';

// SSR does not run effects or event handlers, so hooks are asserted through
// their initial state and the answer through the presentational view. The
// fake fetch is never called — in particular, nothing generates on render.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const ai = new AiClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const INSIGHT: AiInsight = {
  id: 'call_1',
  kind: 'insights',
  scope: 'course',
  courseId: 'course_1',
  feature: 'default',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  text: '- Completion drops 43% after slide 8.\n- Phishing objective: 25% pass rate.',
  usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, costUsd: 0.0081 },
  redactions: { count: 2, counts: { email: 2 } },
  sample: { attempts: 500, truncated: true, from: null, to: null },
  generatedAt: '2026-10-15T10:00:00.000Z',
};

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

describe('AI resource hooks', () => {
  it('start loading', () => {
    function Probe() {
      return (
        <span>
          {state(useAiProviders(ai))},{state(useAiUsage(ai))},{state(useAiCalls(ai, { limit: 10 }))}
        </span>
      );
    }
    expect(renderToStaticMarkup(<Probe />)).toContain('loading,loading,loading');
  });

  it('useAiInsight is idle until generate is called', () => {
    function Probe() {
      const { loading, insight, error } = useAiInsight(ai);
      return <span>{`${loading}:${insight === null}:${error === null}`}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toContain('false:true:true');
  });

  it('useAiClient returns the provided client.ai', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    let seen: AiClient | undefined;
    function Probe() {
      seen = useAiClient();
      return null;
    }
    renderToStaticMarkup(
      <ScormProvider client={client}>
        <Probe />
      </ScormProvider>,
    );
    expect(seen).toBe(client.ai);
  });
});

describe('<AiInsightPanel/>', () => {
  it('renders a generate button and no answer until asked', () => {
    const html = renderToStaticMarkup(<AiInsightPanel client={ai} courseId="course_1" kind="recommendations" />);
    expect(html).toContain('AI recommendations');
    expect(html).toContain('>Generate</button>');
    expect(html).not.toContain('data-scormflow-ai-insight');
  });

  it('takes the client from <ScormProvider>', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <AiInsightPanel title="What changed?" />
      </ScormProvider>,
    );
    expect(html).toContain('What changed?');
  });

  it('throws without a client', () => {
    expect(() => renderToStaticMarkup(<AiInsightPanel />)).toThrow(/needs a `client` prop/);
  });
});

describe('<AiInsightView/>', () => {
  it('shows the text and where it came from', () => {
    const html = renderToStaticMarkup(<AiInsightView insight={INSIGHT} />);
    expect(html).toContain('Completion drops 43% after slide 8.');
    expect(html).toContain('claude-sonnet-5-5 · 1,500 tokens · 500+ attempts · $0.0081 · 2 redactions');
  });

  it('hands the text to a custom renderer', () => {
    const html = renderToStaticMarkup(<AiInsightView insight={INSIGHT} renderText={(t) => <em>{t.length}</em>} />);
    expect(html).toContain(`<em>${INSIGHT.text.length}</em>`);
  });
});

describe('describeAiInsight / describeAiError', () => {
  it('omits cost and redactions when there are none', () => {
    expect(
      describeAiInsight({
        ...INSIGHT,
        usage: { ...INSIGHT.usage, costUsd: null },
        redactions: { count: 0, counts: {} },
        sample: { ...INSIGHT.sample, attempts: 1, truncated: false },
      }),
    ).toBe('claude-sonnet-5-5 · 1,500 tokens · 1 attempt');
  });

  it('maps engine error codes to messages', () => {
    const err = (code: string, status = 400) => new ScormHttpError(status, { code, message: 'raw' }, '');
    expect(describeAiError(err('ai_budget_exceeded', 429))).toMatch(/budget is used up/);
    expect(describeAiError(err('ai_not_configured', 404))).toMatch(/No AI provider/);
    expect(describeAiError(err('ai_provider_auth', 502))).toMatch(/rejected the API key/);
    expect(describeAiError(err('something_else'))).toBe('raw');
    expect(describeAiError(null)).toBe('Something went wrong.');
  });
});
