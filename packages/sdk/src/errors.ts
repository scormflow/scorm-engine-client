import { parseRateLimit, parseRetryAfter, type RateLimitInfo } from './http/retry.js';

export interface ScormErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export class ScormError extends Error {
  override readonly name: string = 'ScormError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class ScormHttpError extends ScormError {
  override readonly name: string = 'ScormHttpError';
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  readonly body?: unknown;

  constructor(
    status: number,
    body: ScormErrorBody | undefined,
    fallbackMessage: string,
    raw?: unknown,
  ) {
    super(body?.message ?? fallbackMessage);
    this.status = status;
    this.code = body?.code ?? `http_${status}`;
    if (body?.requestId !== undefined) this.requestId = body.requestId;
    if (body?.details !== undefined) this.details = body.details;
    if (raw !== undefined) this.body = raw;
  }
}

/**
 * A `429`: the tenant has used up its request budget. The request was not
 * processed, so it is safe to resend once `retryAfterMs` has passed.
 */
export class ScormRateLimitError extends ScormHttpError {
  override readonly name: string = 'ScormRateLimitError';
  /** How long the server asked us to wait, from `Retry-After`; null if it did not say. */
  readonly retryAfterMs: number | null;
  /** The budget reported in `X-RateLimit-*` headers, when present. */
  readonly rateLimit: RateLimitInfo | null;

  constructor(
    body: ScormErrorBody | undefined,
    fallbackMessage: string,
    raw: unknown,
    retryAfterMs: number | null,
    rateLimit: RateLimitInfo | null,
  ) {
    super(429, body, fallbackMessage, raw);
    this.retryAfterMs = retryAfterMs;
    this.rateLimit = rateLimit;
  }
}

/** Build the error for a failed response — a {@link ScormRateLimitError} for 429s. */
export function createHttpError(
  status: number,
  headers: { get(name: string): string | null },
  raw: unknown,
  fallbackMessage: string,
): ScormHttpError {
  const body = (raw ?? undefined) as ScormErrorBody | undefined;
  if (status === 429) {
    return new ScormRateLimitError(
      body,
      fallbackMessage,
      raw,
      parseRetryAfter(headers.get('retry-after')),
      parseRateLimit(headers),
    );
  }
  return new ScormHttpError(status, body, fallbackMessage, raw);
}

export class ScormNetworkError extends ScormError {
  override readonly name = 'ScormNetworkError';
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

export class ScormTimeoutError extends ScormError {
  override readonly name = 'ScormTimeoutError';
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

export class ScormAbortError extends ScormError {
  override readonly name = 'ScormAbortError';
  constructor() {
    super('Request was aborted');
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
