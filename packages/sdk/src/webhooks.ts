/**
 * Webhooks, in two halves.
 *
 *  - {@link WebhooksClient} manages endpoints and reads the delivery log
 *    against the engine's `/webhooks` REST surface (tenant API key).
 *
 *  - {@link verifyWebhookSignature} / {@link constructWebhookEvent} run in the
 *    **receiver**: check a delivery's `ScormFlow-Signature` against the raw
 *    request body before trusting it. They use Web Crypto, so they work in
 *    Node ≥ 20, Deno, Bun, edge runtimes and browsers alike.
 */
import { ScormError } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';

export const WEBHOOK_SIGNATURE_HEADER = 'ScormFlow-Signature';
export const WEBHOOK_EVENT_HEADER = 'ScormFlow-Event';
export const WEBHOOK_DELIVERY_HEADER = 'ScormFlow-Delivery';

export type WebhookEventType =
  | 'attempt.started'
  | 'attempt.suspended'
  | 'attempt.terminated'
  | 'course.completed'
  | 'course.passed'
  | 'course.failed'
  | 'score.updated'
  | 'objective.mastered'
  | 'certificate.issued'
  | 'certificate.revoked'
  | 'cmi5.session.terminated'
  | 'cmi5.session.abandoned'
  | 'cmi5.au.waived'
  | 'cmi5.block.satisfied'
  | 'cmi5.course.satisfied'
  | 'xapi.statement.stored'
  | 'webhook.test';

/** An event type, or `*` for every event. */
export type WebhookSubscription = WebhookEventType | '*';

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookSubscription[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** HMAC-SHA256 signing secret. Shown only on create and rotation — store it. */
  secret: string;
}

export interface CreateWebhookRequest {
  url: string;
  events: WebhookSubscription[];
  description?: string | null;
  enabled?: boolean;
}

export type UpdateWebhookRequest = Partial<CreateWebhookRequest>;

/** `FAILED` is the dead-letter state: out of retries until retried by hand. */
export type WebhookDeliveryStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

/** The JSON body of every delivery. */
export interface WebhookPayload<T = Record<string, unknown>> {
  /** Event id — the same on every endpoint's copy and every retry. Dedupe on it. */
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: T;
}

/** `data` of an `objective.mastered` event: a SCORM objective first reached `passed`. */
export interface ObjectiveMasteredEventData {
  attemptId: string;
  courseId: string;
  scoId: string | null;
  learnerId: string | null;
  objective: {
    id: string;
    index: number;
    successStatus: 'PASSED';
    completionStatus: string | null;
    score: { raw: number | null; min: number | null; max: number | null; scaled: number | null };
  };
}

/** `data` of an `xapi.statement.stored` event. Not sent for a duplicate resend. */
export interface XapiStatementStoredEventData {
  statementId: string;
  verbId: string;
  /** The actor's inverse-functional identifier, e.g. `mbox:mailto:ada@example.com`. */
  actor: string;
  objectType: string;
  objectId: string | null;
  registration: string | null;
  /** Set when this statement voids another. */
  voidsStatementId: string | null;
  /** The statement exactly as the LRS stored it. */
  statement: Record<string, unknown>;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: WebhookEventType;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  /** Start of the receiver's last response body. */
  lastResponse: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: WebhookPayload;
}

export interface WebhookDeliveryQuery {
  status?: WebhookDeliveryStatus;
  eventType?: WebhookEventType;
  /** 1–100, default 25. */
  limit?: number;
  /** The previous page's `pagination.nextCursor`. */
  before?: string;
}

export interface WebhookDeliveryList {
  data: WebhookDelivery[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

type Signal = { signal?: AbortSignal };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

export class WebhooksClient {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  async list(options?: Signal): Promise<WebhookEndpoint[]> {
    return (await this.http.get<{ data: WebhookEndpoint[] }>('webhooks', sig(options))).data;
  }

  get(webhookId: string, options?: Signal): Promise<WebhookEndpoint> {
    return this.http.get<WebhookEndpoint>(`webhooks/${enc(webhookId)}`, sig(options));
  }

  /** Not retried: a blind retry could register the endpoint twice. */
  create(body: CreateWebhookRequest, options?: Signal): Promise<WebhookEndpointWithSecret> {
    return this.http.post<WebhookEndpointWithSecret>('webhooks', body, { retries: 0, ...sig(options) });
  }

  update(webhookId: string, body: UpdateWebhookRequest, options?: Signal): Promise<WebhookEndpoint> {
    return this.http.patch<WebhookEndpoint>(`webhooks/${enc(webhookId)}`, body, sig(options));
  }

  delete(webhookId: string): Promise<void> {
    return this.http.delete<void>(`webhooks/${enc(webhookId)}`);
  }

  /** Replace the signing secret; the old one stops working immediately. */
  rotateSecret(webhookId: string, options?: Signal): Promise<WebhookEndpointWithSecret> {
    return this.http.post<WebhookEndpointWithSecret>(`webhooks/${enc(webhookId)}/rotate-secret`, undefined, {
      retries: 0,
      ...sig(options),
    });
  }

  /** Send a `webhook.test` event to this endpoint; resolves with the first attempt's outcome. */
  sendTest(webhookId: string, options?: Signal): Promise<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`webhooks/${enc(webhookId)}/test`, undefined, {
      retries: 0,
      ...sig(options),
    });
  }

  async eventTypes(options?: Signal): Promise<WebhookEventType[]> {
    return (await this.http.get<{ data: WebhookEventType[] }>('webhooks/event-types', sig(options))).data;
  }

  /** An endpoint's delivery log, newest first. */
  listDeliveries(
    webhookId: string,
    query: WebhookDeliveryQuery = {},
    options?: Signal,
  ): Promise<WebhookDeliveryList> {
    return this.http.get<WebhookDeliveryList>(`webhooks/${enc(webhookId)}/deliveries`, {
      query: { ...query },
      ...sig(options),
    });
  }

  getDelivery(deliveryId: string, options?: Signal): Promise<WebhookDelivery> {
    return this.http.get<WebhookDelivery>(`webhooks/deliveries/${enc(deliveryId)}`, sig(options));
  }

  /** Re-send a delivery now — including a dead-lettered one. One attempt; not retried client-side. */
  retryDelivery(deliveryId: string, options?: Signal): Promise<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`webhooks/deliveries/${enc(deliveryId)}/retry`, undefined, {
      retries: 0,
      ...sig(options),
    });
  }
}

// ---------------------------------------------------------------------------
// Receiver side
// ---------------------------------------------------------------------------

export class WebhookSignatureError extends ScormError {
  override readonly name = 'WebhookSignatureError';
}

export interface VerifyWebhookOptions {
  /** Replay window. Default 300 s. */
  toleranceSeconds?: number;
  /** Clock override for tests. */
  now?: Date;
}

/**
 * Check a delivery's `ScormFlow-Signature` header against the **raw** request
 * body (verify before `JSON.parse` — re-serialising changes the bytes). Accepts
 * any `v1` in the header, so receivers keep working mid-rotation.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (!header) return false;
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v) timestamp = Number(v);
    if (k === 'v1' && v) candidates.push(v.toLowerCase());
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || candidates.length === 0) return false;

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > (options.toleranceSeconds ?? 300)) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return candidates.some((c) => constantTimeEqual(c, expected));
}

/**
 * Verify a delivery and parse it. Throws {@link WebhookSignatureError} when the
 * signature is missing, wrong or stale.
 *
 * ```ts
 * // Next.js route handler
 * export async function POST(req: Request) {
 *   const event = await constructWebhookEvent(
 *     await req.text(),
 *     req.headers.get('scormflow-signature'),
 *     process.env.SCORMFLOW_WEBHOOK_SECRET!,
 *   );
 *   if (event.type === 'course.completed') { ... }
 *   return new Response(null, { status: 204 });
 * }
 * ```
 */
export async function constructWebhookEvent<T = Record<string, unknown>>(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): Promise<WebhookPayload<T>> {
  if (!(await verifyWebhookSignature(secret, header, rawBody, options))) {
    throw new WebhookSignatureError('Webhook signature verification failed');
  }
  try {
    return JSON.parse(rawBody) as WebhookPayload<T>;
  } catch (err) {
    throw new WebhookSignatureError('Webhook body is not valid JSON', { cause: err });
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new ScormError('Web Crypto (crypto.subtle) is not available in this runtime');
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, encoder.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
