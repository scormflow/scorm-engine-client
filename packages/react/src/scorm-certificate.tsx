import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import type { Certificate, CertificatesClient } from '@scormflow/sdk';

import { useOptionalScormClient } from './scorm-context.js';
import { useCertificate } from './use-certificates.js';

export interface ScormCertificateProps {
  attemptId: string;
  /** Defaults to the `<ScormProvider>` client's `certificates`. */
  client?: CertificatesClient;
  /**
   * The attempt's player token. When set, the download is a plain link
   * (`?token=`); otherwise the PDF is fetched through the client and saved.
   */
  token?: string;
  /** BCP 47 locale for the completion date. Defaults to the runtime's. */
  locale?: string;
  className?: string;
  style?: CSSProperties;
  /** Label for the download control. Default `"Download PDF"`. */
  downloadLabel?: string;
  /** Rendered while the certificate loads. */
  loadingFallback?: ReactNode;
  /** Rendered when the attempt has no certificate yet. */
  pendingFallback?: ReactNode;
  /** Rendered when loading fails. */
  errorFallback?: (error: unknown) => ReactNode;
}

export interface ScormCertificateViewProps {
  certificate: Certificate;
  locale?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  downloadLabel?: string | undefined;
  /** Link target for the download control. Takes precedence over `onDownload`. */
  downloadHref?: string | undefined;
  /** Called when the download button is pressed (when there is no `downloadHref`). */
  onDownload?: (() => void) | undefined;
  /** Disables the download button, e.g. while a download is in flight. */
  downloading?: boolean | undefined;
}

// Every color/size reads a `--scormflow-*` CSS variable (shared with
// <ScormPlayer/>) with a fallback, so hosts theme it without a stylesheet.
const cardStyle: CSSProperties = {
  boxSizing: 'border-box',
  maxWidth: '40rem',
  padding: '2rem 1.5rem',
  textAlign: 'center',
  fontFamily: 'var(--scormflow-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  color: 'var(--scormflow-fg, #1a1a1a)',
  background: 'var(--scormflow-bg, #ffffff)',
  border: '3px double var(--scormflow-accent, #2563eb)',
  borderRadius: 'var(--scormflow-radius, 8px)',
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.8125rem',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--scormflow-accent, #2563eb)',
};

const nameStyle: CSSProperties = { margin: '1rem 0 0.25rem', fontSize: '1.75rem', fontWeight: 700 };
const mutedStyle: CSSProperties = { margin: 0, fontSize: '0.9375rem', color: 'var(--scormflow-muted, #666)' };
const courseStyle: CSSProperties = { margin: '0.25rem 0 1rem', fontSize: '1.25rem', fontWeight: 600 };
const metaStyle: CSSProperties = { ...mutedStyle, fontSize: '0.8125rem' };

const revokedStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: '0.75rem',
  padding: '0.15rem 0.5rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--scormflow-danger, #b91c1c)',
  border: '1px solid currentColor',
  borderRadius: '4px',
};

const buttonStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: '1.25rem',
  padding: '0.45rem 1rem',
  font: 'inherit',
  fontSize: '0.875rem',
  textDecoration: 'none',
  cursor: 'pointer',
  color: 'var(--scormflow-button-fg, #fff)',
  background: 'var(--scormflow-accent, #2563eb)',
  border: 'none',
  borderRadius: 'var(--scormflow-button-radius, 6px)',
};

const messageStyle: CSSProperties = { ...mutedStyle, padding: '1rem' };

/** "October 12, 2026" in the given locale, read in UTC to match the PDF. */
export function formatCertificateDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The presentational certificate card, for composing your own data flow
 * (e.g. from `useCertificates` or a server component).
 */
export function ScormCertificateView({
  certificate,
  locale,
  className,
  style,
  downloadLabel = 'Download PDF',
  downloadHref,
  onDownload,
  downloading = false,
}: ScormCertificateViewProps): JSX.Element {
  const revoked = certificate.status === 'revoked';
  const meta = [`Completed ${formatCertificateDate(certificate.completedAt, locale)}`];
  if (certificate.scorePercent !== null) meta.push(`Score ${Math.round(certificate.scorePercent)}%`);

  return (
    <section
      className={className}
      style={{ ...cardStyle, ...style }}
      aria-label={`Certificate of completion for ${certificate.courseTitle}`}
      data-status={certificate.status}
    >
      <p style={eyebrowStyle}>Certificate of Completion</p>
      <p style={nameStyle}>{certificate.learnerName}</p>
      <p style={mutedStyle}>has successfully completed</p>
      <p style={courseStyle}>{certificate.courseTitle}</p>
      <p style={metaStyle}>{meta.join(' · ')}</p>
      <p style={metaStyle}>Certificate ID {certificate.serial}</p>
      {revoked ? (
        <span style={revokedStyle} role="status">
          Revoked
        </span>
      ) : null}
      <div>
        {downloadHref ? (
          <a href={downloadHref} style={buttonStyle} download={`certificate-${certificate.serial}.pdf`}>
            {downloadLabel}
          </a>
        ) : onDownload ? (
          <button
            type="button"
            style={{ ...buttonStyle, opacity: downloading ? 0.6 : 1 }}
            onClick={onDownload}
            disabled={downloading}
            aria-busy={downloading}
          >
            {downloadLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Hand a Blob to the browser as a file download. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Drop-in certificate viewer for one attempt: loads the attempt's certificate
 * and renders it as a card with a PDF download. Shows `pendingFallback` until
 * the engine has issued one (on the commit that completes the attempt).
 *
 * ```tsx
 * <ScormCertificate attemptId={attemptId} token={playerToken} />
 * ```
 */
export function ScormCertificate({
  attemptId,
  client,
  token,
  locale,
  className,
  style,
  downloadLabel,
  loadingFallback,
  pendingFallback,
  errorFallback,
}: ScormCertificateProps): JSX.Element {
  const provided = useOptionalScormClient();
  const certificates = client ?? provided?.certificates;
  if (!certificates) {
    throw new Error('<ScormCertificate> needs a `client` prop or a surrounding <ScormProvider>.');
  }

  const { data, error, loading } = useCertificate(certificates, attemptId);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);

  const download = useCallback(async () => {
    if (!data) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      saveBlob(await certificates.attemptPdf(attemptId), `certificate-${data.serial}.pdf`);
    } catch (err) {
      setDownloadError(err);
    } finally {
      setDownloading(false);
    }
  }, [certificates, attemptId, data]);

  if (loading) return <div style={messageStyle}>{loadingFallback ?? 'Loading certificate…'}</div>;
  if (error) {
    return (
      <div style={messageStyle} role="alert">
        {errorFallback ? errorFallback(error) : 'The certificate could not be loaded.'}
      </div>
    );
  }
  if (!data) {
    return (
      <div style={messageStyle}>{pendingFallback ?? 'Complete the course to earn your certificate.'}</div>
    );
  }

  return (
    <>
      <ScormCertificateView
        certificate={data}
        locale={locale}
        className={className}
        style={style}
        downloadLabel={downloadLabel}
        downloadHref={token ? certificates.attemptPdfUrl(attemptId, { token, download: true }) : undefined}
        onDownload={() => void download()}
        downloading={downloading}
      />
      {downloadError ? (
        <div style={messageStyle} role="alert">
          {errorFallback ? errorFallback(downloadError) : 'The PDF could not be downloaded.'}
        </div>
      ) : null}
    </>
  );
}
