import { useId, type CSSProperties, type ReactNode } from 'react';
import type {
  PackageValidationReport,
  ResourceClient,
  ValidationCategory,
  ValidationIssue,
  ValidationSeverity,
} from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { usePackageValidation } from './use-package-validation.js';

export interface PackageValidationViewProps {
  report: PackageValidationReport;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: ReactNode;
  /** Hide `info`-severity issues. Default: false. */
  hideInfo?: boolean | undefined;
}

export interface PackageValidatorProps {
  /** Defaults to the `<ScormProvider>` client's `resources`. */
  client?: ResourceClient;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  hideInfo?: boolean;
  /** Called with each finished report, e.g. to enable an upload button when `valid`. */
  onReport?: (report: PackageValidationReport) => void;
  errorFallback?: (error: unknown) => ReactNode;
}

const panelStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '1rem 1.25rem',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #e5e7eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};
const titleStyle: CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600 };
const mutedStyle: CSSProperties = { fontSize: '0.75rem', color: 'var(--scormflow-muted, #666)' };
const listStyle: CSSProperties = { listStyle: 'none', margin: '0.5rem 0 0', padding: 0, fontSize: '0.8125rem' };
const codeStyle: CSSProperties = { fontFamily: 'var(--scormflow-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: '0.75rem' };

const SEVERITY: Record<ValidationSeverity, { label: string; color: string }> = {
  error: { label: 'Error', color: 'var(--scormflow-danger, #b91c1c)' },
  warning: { label: 'Warning', color: 'var(--scormflow-warning, #b45309)' },
  info: { label: 'Info', color: 'var(--scormflow-muted, #666)' },
};

export const VALIDATION_CATEGORY_LABELS: Record<ValidationCategory, string> = {
  structure: 'Package structure',
  manifest: 'Manifest',
  resources: 'Files and launch pages',
  runtime: 'Runtime compatibility',
  accessibility: 'Accessibility',
  assets: 'Assets',
};

const CATEGORY_ORDER = Object.keys(VALIDATION_CATEGORY_LABELS) as ValidationCategory[];

/** Issues grouped by category in a stable order, errors first within each group. */
export function groupValidationIssues(
  report: PackageValidationReport,
  options: { hideInfo?: boolean | undefined } = {},
): Array<{ category: ValidationCategory; issues: ValidationIssue[] }> {
  const all = [...report.errors, ...report.warnings, ...(options.hideInfo ? [] : report.info)];
  return CATEGORY_ORDER.map((category) => ({
    category,
    issues: all.filter((i) => i.category === category),
  })).filter((g) => g.issues.length > 0);
}

/** One-line verdict, e.g. "Valid — 2 warnings" or "Invalid — 1 error, 3 warnings". */
export function describeValidation(report: PackageValidationReport): string {
  const parts: string[] = [];
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (report.errors.length) parts.push(count(report.errors.length, 'error'));
  if (report.warnings.length) parts.push(count(report.warnings.length, 'warning'));
  const verdict = report.valid ? 'Valid' : 'Invalid';
  return parts.length ? `${verdict} — ${parts.join(', ')}` : `${verdict} — no problems found`;
}

export function formatBytes(n: number): string {
  if (n < 0) return `-${formatBytes(-n)}`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Renders a validation report grouped by category. */
export function PackageValidationView({ report, className, style, title, hideInfo }: PackageValidationViewProps): JSX.Element {
  const groups = groupValidationIssues(report, { hideInfo });
  const manifestTitle = typeof report.manifest?.['title'] === 'string' ? (report.manifest['title'] as string) : null;

  return (
    <section
      className={className}
      style={{ ...panelStyle, ...style }}
      data-scormflow-validation={report.valid ? 'valid' : 'invalid'}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={titleStyle}>{title ?? manifestTitle ?? 'Package validation'}</h3>
        <span style={mutedStyle}>
          {report.version ? `${String(report.version).replace(/_/g, ' ')} · ` : ''}
          {report.stats.fileCount} files · {formatBytes(report.stats.totalBytes)} · {report.stats.launchableCount} SCO
          {report.stats.launchableCount === 1 ? '' : 's'}
        </span>
      </div>

      <p
        role="status"
        style={{
          margin: '0.5rem 0 0',
          fontWeight: 600,
          color: report.valid ? 'var(--scormflow-success, #15803d)' : SEVERITY.error.color,
        }}
      >
        {describeValidation(report)}
      </p>

      {groups.map((group) => (
        <div key={group.category} style={{ marginTop: '0.75rem' }} data-scormflow-validation-category={group.category}>
          <div style={{ ...mutedStyle, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {VALIDATION_CATEGORY_LABELS[group.category]}
          </div>
          <ul style={listStyle}>
            {group.issues.map((issue, i) => (
              <li
                key={`${issue.code}-${i}`}
                data-scormflow-issue={issue.code}
                style={{ display: 'flex', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid var(--scormflow-border, #e5e7eb)' }}
              >
                <span style={{ minWidth: '4.5rem', fontWeight: 600, color: SEVERITY[issue.severity].color }}>
                  {SEVERITY[issue.severity].label}
                </span>
                <span>
                  {issue.message}{' '}
                  <span style={{ ...codeStyle, color: 'var(--scormflow-muted, #666)' }}>({issue.code})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * A file picker that validates the chosen SCORM ZIP against the engine and
 * shows the report. Nothing is uploaded as a course. Needs a client with the
 * API key.
 */
export function PackageValidator({
  client,
  className,
  style,
  title,
  hideInfo,
  onReport,
  errorFallback,
}: PackageValidatorProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const resources = client ?? fromContext?.resources;
  if (!resources) throw new Error('<PackageValidator> needs a `client` prop or a <ScormProvider>.');
  const { validate, status, report, error } = usePackageValidation(resources);
  const inputId = useId();

  return (
    <div className={className} style={style} data-scormflow-validator={status}>
      <label htmlFor={inputId} style={{ display: 'block', ...mutedStyle, marginBottom: '0.35rem' }}>
        Choose a SCORM package (.zip) to validate
      </label>
      <input
        id={inputId}
        type="file"
        accept=".zip,application/zip"
        disabled={status === 'validating'}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (!file) return;
          void validate(file).then((r) => {
            if (r) onReport?.(r);
          });
        }}
      />
      {status === 'validating' ? (
        <p aria-busy="true" style={{ ...mutedStyle, marginTop: '0.5rem' }}>
          Validating…
        </p>
      ) : null}
      {status === 'error' ? (
        <div role="alert" style={{ ...panelStyle, marginTop: '0.75rem', color: SEVERITY.error.color }}>
          {errorFallback ? errorFallback(error) : 'Could not validate the package.'}
        </div>
      ) : null}
      {report ? (
        <PackageValidationView report={report} title={title} hideInfo={hideInfo} style={{ marginTop: '0.75rem' }} />
      ) : null}
    </div>
  );
}
