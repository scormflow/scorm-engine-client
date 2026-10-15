import type { CSSProperties, ReactNode } from 'react';
import type { AiClient, AiInsight, AiInsightKind } from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { describeAiError, useAiInsight } from './use-ai.js';

export interface AiInsightPanelProps {
  /** One course; omit for the whole tenant. */
  courseId?: string;
  /** Default `insights`. */
  kind?: AiInsightKind;
  /** An extra question passed to the model. */
  question?: string;
  /** Defaults to the `<ScormProvider>` client's `ai`. */
  client?: AiClient;
  className?: string;
  style?: CSSProperties;
  /** Panel heading. Default depends on `kind`. */
  title?: ReactNode;
  /** Label of the generate button. Default `"Generate"`, then `"Regenerate"`. */
  generateLabel?: string;
  /** Render the model's Markdown yourself (e.g. with your Markdown renderer); plain pre-wrapped text otherwise. */
  renderText?: (text: string) => ReactNode;
}

export interface AiInsightViewProps {
  insight: AiInsight;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  renderText?: ((text: string) => ReactNode) | undefined;
}

const TITLES: Record<AiInsightKind, string> = {
  insights: 'AI insights',
  summary: 'AI summary',
  recommendations: 'AI recommendations',
};

// Themed through the same `--scormflow-*` variables as the other components.
const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #e5e7eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};

const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' };
const titleStyle: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
const textStyle: CSSProperties = { margin: '0.75rem 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: '0.9375rem' };
const metaStyle: CSSProperties = { margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--scormflow-muted, #666)' };
const errorStyle: CSSProperties = { margin: '0.75rem 0 0', fontSize: '0.875rem', color: 'var(--scormflow-danger, #b91c1c)' };

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

/** "claude-x · 500 tokens · 42 attempts · 1 redaction". */
export function describeAiInsight(insight: AiInsight): string {
  const parts = [
    insight.model,
    `${insight.usage.totalTokens.toLocaleString('en-US')} tokens`,
    `${insight.sample.attempts}${insight.sample.truncated ? '+' : ''} attempt${insight.sample.attempts === 1 ? '' : 's'}`,
  ];
  if (insight.usage.costUsd != null) parts.push(`$${insight.usage.costUsd.toFixed(4)}`);
  if (insight.redactions.count > 0) {
    parts.push(`${insight.redactions.count} redaction${insight.redactions.count === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/** The presentational answer: the model's text plus a provenance line. */
export function AiInsightView({ insight, className, style, renderText }: AiInsightViewProps): JSX.Element {
  return (
    <div className={className} style={style} data-scormflow-ai-insight={insight.id}>
      {renderText ? renderText(insight.text) : <p style={textStyle}>{insight.text}</p>}
      <p style={metaStyle}>{describeAiInsight(insight)}</p>
    </div>
  );
}

/**
 * A panel that asks the engine's AI layer about a course (or the whole
 * tenant) when the user presses its button — never on mount, because each
 * answer spends the tenant's tokens. Needs a client with the API key.
 */
export function AiInsightPanel({
  courseId,
  kind = 'insights',
  question,
  client,
  className,
  style,
  title,
  generateLabel,
  renderText,
}: AiInsightPanelProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const ai = client ?? fromContext?.ai;
  if (!ai) throw new Error('<AiInsightPanel> needs a `client` prop or a <ScormProvider>.');
  const { insight, error, loading, generate } = useAiInsight(ai);

  const onGenerate = () => {
    void generate({ kind, ...(courseId ? { courseId } : {}), ...(question ? { question } : {}) });
  };

  return (
    <section className={className} style={{ ...panelStyle, ...style }} aria-busy={loading}>
      <div style={headerStyle}>
        <h3 style={titleStyle}>{title ?? TITLES[kind]}</h3>
        <button type="button" style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={onGenerate}>
          {loading ? 'Generating…' : (generateLabel ?? (insight ? 'Regenerate' : 'Generate'))}
        </button>
      </div>
      {error ? (
        <p role="alert" style={errorStyle}>
          {describeAiError(error)}
        </p>
      ) : null}
      {insight ? <AiInsightView insight={insight} renderText={renderText} /> : null}
    </section>
  );
}
