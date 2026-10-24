/**
 * Completion certificates against the engine's `/certificates` and
 * `/attempts/:id/certificate` REST surface.
 *
 * The engine issues a certificate automatically the first time an attempt is
 * completed and not failed. Tenant-wide calls (`list`, `get`, `pdf`, `revoke`,
 * `issue`) need the API key; the attempt-scoped reads (`forAttempt`,
 * `attemptPdf`, `attemptPdfUrl`) also work with the attempt's player token, so
 * a learner-facing page can show and download its own certificate. `verify`
 * is public.
 */
import { ScormHttpError } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';

export type CertificateStatus = 'valid' | 'revoked';

export interface Certificate {
  id: string;
  /** Public verification code printed on the PDF, e.g. `7KQ2-M9XD-4TPA`. */
  serial: string;
  status: CertificateStatus;
  attemptId: string;
  courseId: string;
  /** The learner's id in your system. */
  learnerId: string | null;
  /** As printed: the learner's name at issue time, or their id if they had none. */
  learnerName: string;
  /** The course title at issue time. */
  courseTitle: string;
  /** 0–100, or null when the attempt reported no score. */
  scorePercent: number | null;
  completedAt: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  /** Server-relative path of the PDF (API key auth). */
  pdfUrl: string;
}

/** What anyone holding the printed code can learn from `verify`. */
export interface CertificateVerification {
  /** False once the certificate is revoked. */
  valid: boolean;
  serial: string;
  status: CertificateStatus;
  learnerName: string;
  courseTitle: string;
  issuer: string;
  completedAt: string;
  issuedAt: string;
  revokedAt: string | null;
}

export interface CertificateQuery {
  /** The learner's id in your system. */
  learnerId?: string;
  courseId?: string;
  status?: CertificateStatus;
  /** 1–100, default 25. */
  limit?: number;
  /** The previous page's `pagination.nextCursor`. */
  before?: string;
}

export interface CertificateList {
  data: Certificate[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

export interface IssueCertificateResult {
  certificate: Certificate;
  /** False when the attempt already had a certificate. */
  created: boolean;
}

/** `data` of the `certificate.issued` and `certificate.revoked` webhook events. */
export interface CertificateEventData {
  certificateId: string;
  serial: string;
  attemptId: string;
  courseId: string;
  learnerId: string | null;
  learnerName: string;
  courseTitle: string;
  scorePercent: number | null;
  completedAt: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface CertificatePdfUrlOptions {
  /** Attempt token, for an `<a href>` that can't send an Authorization header. */
  token?: string;
  /** Ask the browser to save the file rather than open it. */
  download?: boolean;
}

type Signal = { signal?: AbortSignal };
type PdfOptions = Signal & { download?: boolean };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;
const PDF_HEADERS = { accept: 'application/pdf' };

export class CertificatesClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  /** The tenant's certificates, newest first. */
  list(query: CertificateQuery = {}, options?: Signal): Promise<CertificateList> {
    return this.http.get<CertificateList>('certificates', { query: { ...query }, ...sig(options) });
  }

  get(certificateId: string, options?: Signal): Promise<Certificate> {
    return this.http.get<Certificate>(`certificates/${enc(certificateId)}`, sig(options));
  }

  /** The certificate PDF as a Blob. */
  async pdf(certificateId: string, options?: PdfOptions): Promise<Blob> {
    return this.fetchPdf(`certificates/${enc(certificateId)}/pdf`, options);
  }

  /** Revoke: verification then reports it invalid and the PDF is stamped REVOKED. */
  revoke(certificateId: string, reason?: string, options?: Signal): Promise<Certificate> {
    return this.http.post<Certificate>(
      `certificates/${enc(certificateId)}/revoke`,
      reason === undefined ? {} : { reason },
      sig(options),
    );
  }

  /**
   * Check a printed code. Needs no credentials; case, spaces and dashes are
   * ignored. Resolves `null` when no certificate has that code.
   */
  async verify(serial: string, options?: Signal): Promise<CertificateVerification | null> {
    try {
      return await this.http.get<CertificateVerification>(`certificates/verify/${enc(serial.trim())}`, sig(options));
    } catch (err) {
      if (err instanceof ScormHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * The attempt's certificate, or `null` if it has none yet. Works with the
   * attempt's player token.
   */
  async forAttempt(attemptId: string, options?: Signal): Promise<Certificate | null> {
    try {
      return await this.http.get<Certificate>(`attempts/${enc(attemptId)}/certificate`, sig(options));
    } catch (err) {
      if (err instanceof ScormHttpError && err.status === 404 && err.code === 'certificate_not_found') return null;
      throw err;
    }
  }

  /** The attempt's certificate PDF as a Blob. Works with the attempt's player token. */
  attemptPdf(attemptId: string, options?: PdfOptions): Promise<Blob> {
    return this.fetchPdf(`attempts/${enc(attemptId)}/certificate/pdf`, options);
  }

  /**
   * A URL for the attempt's certificate PDF, for a plain link or iframe. Pass
   * the attempt token — a link can't carry the API key, and shouldn't.
   */
  attemptPdfUrl(attemptId: string, options: CertificatePdfUrlOptions = {}): string {
    const params = new URLSearchParams();
    if (options.token) params.set('token', options.token);
    if (options.download) params.set('download', '1');
    const qs = params.toString();
    return `${this.http.baseUrl}/attempts/${enc(attemptId)}/certificate/pdf${qs ? `?${qs}` : ''}`;
  }

  /**
   * Issue the attempt's certificate now — for attempts that finished before
   * certificates were enabled. Idempotent; rejects with a 409
   * (`attempt_not_eligible`) unless the attempt is completed and not failed.
   * Not retried: the server is idempotent, but a 409 is final.
   */
  async issue(attemptId: string, options?: Signal): Promise<IssueCertificateResult> {
    const res = await this.http.raw({
      method: 'POST',
      path: `attempts/${enc(attemptId)}/certificate`,
      retries: 0,
      ...sig(options),
    });
    return { certificate: (await res.json()) as Certificate, created: res.status === 201 };
  }

  private async fetchPdf(path: string, options?: PdfOptions): Promise<Blob> {
    const res = await this.http.raw({
      method: 'GET',
      path,
      headers: PDF_HEADERS,
      ...(options?.download ? { query: { download: 1 } } : {}),
      ...sig(options),
    });
    return res.blob();
  }
}
