import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { CourseVersion, CourseVersionDiff, CourseVersionsClient } from '@scormflow/sdk';

import { formatBytes } from './package-validation.js';
import { useOptionalScormClient } from './scorm-context.js';
import { useCourseVersionDiff, useCourseVersions } from './use-course-versions.js';

export interface CourseVersionDiffViewProps {
  diff: CourseVersionDiff;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Files listed per added / removed / modified group before "+N more". Default 20. */
  maxFiles?: number | undefined;
}

export interface CourseVersionHistoryProps {
  courseId: string;
  /** Defaults to the `<ScormProvider>` client's `courses.versions`. */
  client?: CourseVersionsClient;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  /** Show the "publish a new release" form. Default true. */
  allowPublish?: boolean;
  /** Show "Make live" buttons on non-live releases. Default true. */
  allowRollback?: boolean;
  /** Asked before a rollback; return false to cancel. Default: no confirmation. */
  confirmRollback?: (version: CourseVersion) => boolean;
  /** Called after a publish or rollback succeeds. */
  onChange?: (version: CourseVersion) => void;
  locale?: string;
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
const rowStyle: CSSProperties = { padding: '0.6rem 0', borderBottom: '1px solid var(--scormflow-border, #e5e7eb)' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: '0.75rem',
  padding: '0.25rem 0.6rem',
  cursor: 'pointer',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '1px solid var(--scormflow-border, #d1d5db)',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
};
const badgeStyle: CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  padding: '0.1rem 0.45rem',
  borderRadius: '999px',
  color: 'var(--scormflow-accent-fg, #ffffff)',
  background: 'var(--scormflow-accent, #2563eb)',
};
const dangerColor = 'var(--scormflow-danger, #b91c1c)';
const addedColor = 'var(--scormflow-success, #15803d)';

/** "Oct 22, 2026" in the given locale (UTC). */
export function formatVersionDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** One-line summary, e.g. "1.0 → 1.1: 1 SCO added, 3 files changed". */
export function describeVersionDiff(diff: CourseVersionDiff): string {
  const head = `${diff.from.label} → ${diff.to.label}`;
  if (diff.identical) return `${head}: no changes`;
  const parts: string[] = [];
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (diff.metadata.length > 0) parts.push(count(diff.metadata.length, 'metadata change'));
  if (diff.scos.added.length > 0) parts.push(`${count(diff.scos.added.length, 'SCO')} added`);
  if (diff.scos.removed.length > 0) parts.push(`${count(diff.scos.removed.length, 'SCO')} removed`);
  if (diff.scos.changed.length > 0) parts.push(`${count(diff.scos.changed.length, 'SCO')} changed`);
  if (diff.assets) {
    const files = diff.assets.added.length + diff.assets.removed.length + diff.assets.modified.length;
    if (files > 0) parts.push(`${count(files, 'file')} changed`);
  } else {
    parts.push('file changes unknown');
  }
  return `${head}: ${parts.length > 0 ? parts.join(', ') : 'no changes'}`;
}

const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));

/** Renders a release diff: breaking changes, metadata, SCOs and files. */
export function CourseVersionDiffView({ diff, className, style, maxFiles = 20 }: CourseVersionDiffViewProps): JSX.Element {
  const files = (label: string, color: string | undefined, paths: Array<{ path: string; note?: string }>) =>
    paths.length === 0 ? null : (
      <div style={{ marginTop: '0.5rem' }} data-scormflow-diff-files={label.toLowerCase()}>
        <div style={{ ...mutedStyle, fontWeight: 600 }}>
          {label} ({paths.length})
        </div>
        <ul style={listStyle}>
          {paths.slice(0, maxFiles).map((f) => (
            <li key={f.path} style={{ ...codeStyle, color }}>
              {f.path}
              {f.note ? <span style={mutedStyle}> {f.note}</span> : null}
            </li>
          ))}
          {paths.length > maxFiles ? <li style={mutedStyle}>+{paths.length - maxFiles} more</li> : null}
        </ul>
      </div>
    );

  return (
    <div className={className} style={{ ...panelStyle, ...style }} data-scormflow-version-diff="">
      <h4 style={titleStyle}>{describeVersionDiff(diff)}</h4>

      {diff.breakingChanges.length > 0 ? (
        <div role="note" style={{ marginTop: '0.5rem', color: dangerColor, fontSize: '0.8125rem' }}>
          <strong>Heads up:</strong> learners who relaunch on {diff.to.label} may lose their place —
          <ul style={{ ...listStyle, marginTop: '0.25rem' }}>
            {diff.breakingChanges.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff.metadata.length > 0 ? (
        <ul style={listStyle} data-scormflow-diff-metadata="">
          {diff.metadata.map((c) => (
            <li key={c.field}>
              <span style={{ fontWeight: 600 }}>{c.field}</span>: {show(c.from)} → {show(c.to)}
            </li>
          ))}
        </ul>
      ) : null}

      {diff.scos.added.length + diff.scos.removed.length + diff.scos.changed.length > 0 ? (
        <ul style={listStyle} data-scormflow-diff-scos="">
          {diff.scos.added.map((s) => (
            <li key={`+${s.identifier}`} style={{ color: addedColor }}>
              + SCO {s.title} <span style={codeStyle}>({s.identifier})</span>
            </li>
          ))}
          {diff.scos.removed.map((s) => (
            <li key={`-${s.identifier}`} style={{ color: dangerColor }}>
              − SCO {s.title} <span style={codeStyle}>({s.identifier})</span>
            </li>
          ))}
          {diff.scos.changed.map((s) => (
            <li key={`~${s.identifier}`}>
              ~ SCO <span style={codeStyle}>{s.identifier}</span>:{' '}
              {s.changes.map((c) => `${c.field} ${show(c.from)} → ${show(c.to)}`).join('; ')}
            </li>
          ))}
        </ul>
      ) : null}

      {diff.assets ? (
        <>
          {files('Added', addedColor, diff.assets.added.map((f) => ({ path: f.path, note: formatBytes(f.sizeBytes) })))}
          {files('Removed', dangerColor, diff.assets.removed.map((f) => ({ path: f.path })))}
          {files(
            'Modified',
            undefined,
            diff.assets.modified.map((f) => ({
              path: f.path,
              note: `${formatBytes(f.fromSizeBytes)} → ${formatBytes(f.toSizeBytes)}`,
            })),
          )}
          <p style={{ ...mutedStyle, margin: '0.5rem 0 0' }}>
            {diff.assets.unchangedCount} unchanged · size {diff.assets.bytesDelta >= 0 ? '+' : ''}
            {formatBytes(diff.assets.bytesDelta)}
          </p>
        </>
      ) : (
        <p style={{ ...mutedStyle, margin: '0.5rem 0 0' }}>
          File changes can't be compared: one of these releases predates versioning.
        </p>
      )}
    </div>
  );
}

/**
 * A course's release history: the live release, each release's notes, a diff
 * against the release before it, "Make live" (rollback) and a publish form.
 * Needs a client with the API key.
 */
export function CourseVersionHistory({
  courseId,
  client,
  className,
  style,
  title,
  allowPublish = true,
  allowRollback = true,
  confirmRollback,
  onChange,
  locale,
  errorFallback,
}: CourseVersionHistoryProps): JSX.Element {
  const fromContext = useOptionalScormClient();
  const versions = client ?? fromContext?.courses.versions;
  if (!versions) throw new Error('<CourseVersionHistory> needs a `client` prop or a <ScormProvider>.');
  const { data, loading, error, pending, actionError, publish, rollback } = useCourseVersions(versions, courseId);
  const [compare, setCompare] = useState<number | null>(null);
  const diff = useCourseVersionDiff(
    versions,
    courseId,
    compare === null ? {} : { from: compare - 1, to: compare },
    compare !== null,
  );

  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [bump, setBump] = useState<'minor' | 'major'>('minor');
  const fileId = useId();
  const notesId = useId();

  const failure = (err: unknown, fallback: string) => (
    <div role="alert" style={{ ...panelStyle, marginTop: '0.75rem', color: dangerColor }}>
      {errorFallback ? errorFallback(err) : fallback}
    </div>
  );

  return (
    <div
      className={className}
      style={{ ...panelStyle, ...style }}
      data-scormflow-version-history={loading ? 'loading' : error ? 'error' : 'ready'}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
        <h3 style={titleStyle}>{title ?? 'Releases'}</h3>
        {data?.currentVersion != null ? (
          <span style={mutedStyle}>
            Live: {data.data.find((v) => v.number === data.currentVersion)?.label ?? data.currentVersion}
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <p aria-busy="true" style={{ ...mutedStyle, marginTop: '0.5rem' }}>
          Loading releases…
        </p>
      ) : null}
      {error ? failure(error, 'Could not load releases.') : null}
      {data && data.data.length === 0 ? (
        <p style={{ ...mutedStyle, marginTop: '0.5rem' }}>
          No releases recorded yet — this course predates versioning. Publish one to start its history.
        </p>
      ) : null}

      {data && data.data.length > 0 ? (
        <ol style={{ ...listStyle, marginTop: '0.75rem' }}>
          {data.data.map((v) => (
            <li key={v.id} style={rowStyle} data-scormflow-version={v.number} data-current={v.current || undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong>{v.label}</strong>
                {v.current ? <span style={badgeStyle}>Live</span> : null}
                <span style={mutedStyle}>
                  #{v.number} · {formatVersionDate(v.createdAt, locale)} · {v.scoCount} SCO
                  {v.scoCount === 1 ? '' : 's'}
                  {v.fileCount > 0 ? ` · ${v.fileCount} files · ${formatBytes(v.sizeBytes)}` : ''}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
                  {v.number > 1 ? (
                    <button
                      type="button"
                      style={buttonStyle}
                      aria-expanded={compare === v.number}
                      onClick={() => setCompare(compare === v.number ? null : v.number)}
                    >
                      {compare === v.number ? 'Hide changes' : 'Changes'}
                    </button>
                  ) : null}
                  {allowRollback && !v.current ? (
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={pending !== null}
                      onClick={() => {
                        if (confirmRollback && !confirmRollback(v)) return;
                        void rollback(v.number).then((r) => {
                          if (r) onChange?.(r);
                        });
                      }}
                    >
                      Make live
                    </button>
                  ) : null}
                </span>
              </div>
              {v.releaseNotes ? (
                <p style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>{v.releaseNotes}</p>
              ) : null}
              {compare === v.number ? (
                <div style={{ marginTop: '0.5rem' }}>
                  {diff.loading ? <p aria-busy="true" style={mutedStyle}>Comparing…</p> : null}
                  {diff.error ? failure(diff.error, 'Could not compare these releases.') : null}
                  {diff.data && !diff.loading ? <CourseVersionDiffView diff={diff.data} /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {actionError ? failure(actionError, 'That change could not be saved.') : null}

      {allowPublish ? (
        <form
          style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            void publish(file, { bump, ...(notes.trim() ? { releaseNotes: notes.trim() } : {}) }).then((r) => {
              if (!r) return;
              setFile(null);
              setNotes('');
              onChange?.(r);
            });
          }}
        >
          <label htmlFor={fileId} style={{ ...mutedStyle, fontWeight: 600 }}>
            Publish a new release (.zip)
          </label>
          <input
            id={fileId}
            type="file"
            accept=".zip,application/zip"
            disabled={pending !== null}
            onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
          />
          <label htmlFor={notesId} style={mutedStyle}>
            Release notes
          </label>
          <textarea
            id={notesId}
            rows={3}
            value={notes}
            disabled={pending !== null}
            onChange={(e) => setNotes(e.currentTarget.value)}
            style={{ font: 'inherit', fontSize: '0.8125rem' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label style={mutedStyle}>
              <input type="radio" name={`${fileId}-bump`} checked={bump === 'minor'} onChange={() => setBump('minor')} />{' '}
              Minor
            </label>
            <label style={mutedStyle}>
              <input type="radio" name={`${fileId}-bump`} checked={bump === 'major'} onChange={() => setBump('major')} />{' '}
              Major
            </label>
            <button type="submit" style={buttonStyle} disabled={!file || pending !== null}>
              {pending === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          </div>
          <p style={{ ...mutedStyle, margin: 0 }}>
            Learners already in the course keep the release they started on.
          </p>
        </form>
      ) : null}
    </div>
  );
}
