import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CertificatesClient, ScormClient, type Certificate } from '@scormflow/sdk';

import { ScormProvider } from './scorm-context.js';
import { ScormCertificate, ScormCertificateView, formatCertificateDate } from './scorm-certificate.js';
import { useCertificate, useCertificates } from './use-certificates.js';

// SSR does not run effects, so the data-driven states are asserted through the
// presentational view, and the hooks/component through their initial state.
// The fake fetch is never called.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const certificates = new CertificatesClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const CERT: Certificate = {
  id: 'cert_1',
  serial: '7KQ2-M9XD-4TPA',
  status: 'valid',
  attemptId: 'att_1',
  courseId: 'course_1',
  learnerId: 'learner-1',
  learnerName: 'Ada Lovelace',
  courseTitle: 'Safety Basics',
  scorePercent: 92.4,
  completedAt: '2026-10-12T23:30:00.000Z',
  issuedAt: '2026-10-12T23:30:01.000Z',
  revokedAt: null,
  revokedReason: null,
  pdfUrl: '/api/v1/certificates/cert_1/pdf',
};

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

function CertificateState({ attemptId }: { attemptId: string | null }) {
  return <span>{state(useCertificate(certificates, attemptId))}</span>;
}

function ListState() {
  return <span>{state(useCertificates(certificates, { status: 'valid' }))}</span>;
}

describe('useCertificate / useCertificates', () => {
  it('loads with an attempt id and idles without one', () => {
    expect(renderToStaticMarkup(<CertificateState attemptId="att_1" />)).toContain('loading');
    expect(renderToStaticMarkup(<CertificateState attemptId={null} />)).toContain('idle');
    expect(renderToStaticMarkup(<ListState />)).toContain('loading');
  });
});

describe('ScormCertificateView', () => {
  it('renders the learner, course, date, score and serial', () => {
    const html = renderToStaticMarkup(<ScormCertificateView certificate={CERT} locale="en-US" />);
    expect(html).toContain('Certificate of Completion');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Safety Basics');
    // Read in UTC, as printed on the PDF.
    expect(html).toContain('Completed October 12, 2026 · Score 92%');
    expect(html).toContain('Certificate ID 7KQ2-M9XD-4TPA');
    expect(html).toContain('data-status="valid"');
    expect(html).not.toContain('Revoked');
    // No download control unless one is wired.
    expect(html).not.toContain('Download PDF');
  });

  it('omits a missing score and flags revoked certificates', () => {
    const html = renderToStaticMarkup(
      <ScormCertificateView certificate={{ ...CERT, scorePercent: null, status: 'revoked' }} locale="en-US" />,
    );
    expect(html).not.toContain('Score');
    expect(html).toContain('Revoked');
    expect(html).toContain('data-status="revoked"');
  });

  it('renders a link download when given an href, else a button', () => {
    const link = renderToStaticMarkup(
      <ScormCertificateView certificate={CERT} downloadHref="https://engine.test/x.pdf" downloadLabel="Save" />,
    );
    expect(link).toContain('<a href="https://engine.test/x.pdf"');
    expect(link).toContain('download="certificate-7KQ2-M9XD-4TPA.pdf"');
    expect(link).toContain('>Save</a>');

    const button = renderToStaticMarkup(<ScormCertificateView certificate={CERT} onDownload={() => undefined} downloading />);
    expect(button).toContain('<button type="button"');
    expect(button).toContain('disabled');
  });
});

describe('ScormCertificate', () => {
  it('starts loading, with a custom fallback', () => {
    expect(renderToStaticMarkup(<ScormCertificate attemptId="att_1" client={certificates} />)).toContain(
      'Loading certificate…',
    );
    expect(
      renderToStaticMarkup(<ScormCertificate attemptId="att_1" client={certificates} loadingFallback="Please wait" />),
    ).toContain('Please wait');
  });

  it('reads the client from a ScormProvider', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <ScormCertificate attemptId="att_1" />
      </ScormProvider>,
    );
    expect(html).toContain('Loading certificate…');
  });

  it('explains what it needs outside a provider', () => {
    expect(() => renderToStaticMarkup(<ScormCertificate attemptId="att_1" />)).toThrow(/client.*ScormProvider/);
  });
});

describe('formatCertificateDate', () => {
  it('formats in UTC and passes through unparseable input', () => {
    expect(formatCertificateDate('2026-01-01T23:30:00-05:00', 'en-GB')).toBe('2 January 2026');
    expect(formatCertificateDate('soon')).toBe('soon');
  });
});
