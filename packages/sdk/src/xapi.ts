/**
 * `XapiClient` — the client half of the engine's built-in Learning Record Store.
 *
 * Covers the xAPI 1.0.3 resources the engine serves under `/xapi`: Statements,
 * State, Activity Profile, Agent Profile, the Activity and Agent (Person)
 * lookups, and About.
 *
 * Two conveniences over raw HTTP, both chosen because the spec makes them
 * tedious by hand:
 *
 *  - every request carries `X-Experience-API-Version` (About excepted, since
 *    that resource exists to discover the version in the first place);
 *  - document reads return the body *and* its `ETag`, so a caller can pass the
 *    etag straight back as `ifMatch` on the next write without touching headers.
 *
 * Reading a document that does not exist returns `null` rather than throwing —
 * "no document yet" is the normal first state of any bookmark or profile, not
 * an error.
 */
import { ScormHttpError } from './errors.js';
import { HttpClient, type HttpClientOptions } from './http/http-client.js';
import {
  decodeStatementResponse,
  encodeStatementUpload,
  prepareXapiAttachment,
  type XapiAttachment,
  type XapiAttachmentBody,
  type XapiAttachmentInput,
} from './xapi-attachments.js';

export const XAPI_VERSION = '1.0.3';

export type XapiClientOptions = HttpClientOptions;

/** An Agent or Group, as xAPI defines it. */
export interface XapiAgent {
  objectType?: 'Agent' | 'Group';
  name?: string;
  mbox?: string;
  mbox_sha1sum?: string;
  openid?: string;
  account?: { homePage: string; name: string };
  member?: XapiAgent[];
}

export interface XapiStatement {
  id?: string;
  actor: XapiAgent;
  verb: { id: string; display?: Record<string, string> };
  object: unknown;
  result?: unknown;
  context?: unknown;
  timestamp?: string;
  stored?: string;
  authority?: XapiAgent;
  attachments?: XapiAttachment[];
  [key: string]: unknown;
}

export interface XapiStoreOptions {
  /**
   * Bodies for the attachments the statements declare (see
   * {@link XapiClient.prepareAttachment}). When present the request is sent as
   * `multipart/mixed`.
   */
  attachments?: XapiAttachmentBody[];
  signal?: AbortSignal;
}

/** How much of each statement a query returns. */
export type XapiFormat = 'ids' | 'exact' | 'canonical';

export interface XapiStatementQuery {
  agent?: XapiAgent;
  verb?: string;
  activity?: string;
  registration?: string;
  relatedActivities?: boolean;
  relatedAgents?: boolean;
  since?: string | Date;
  until?: string | Date;
  limit?: number;
  ascending?: boolean;
  format?: XapiFormat;
  signal?: AbortSignal;
}

export interface XapiStatementResult {
  statements: XapiStatement[];
  /** Opaque link to the next page, or `''` when this is the last one. */
  more: string;
}

/** A stored document plus the metadata needed to write it back safely. */
export interface XapiDocument<T = unknown> {
  /** Parsed JSON when the document is JSON; otherwise the raw text. */
  content: T;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
}

/** Conditional-write headers. Pass the `etag` from a previous read as `ifMatch`. */
export interface XapiWriteOptions {
  ifMatch?: string;
  /** `'*'` is the idiomatic "only if it does not exist yet". */
  ifNoneMatch?: string;
  /** Defaults to `application/json` for objects, `text/plain` for strings. */
  contentType?: string;
  signal?: AbortSignal;
}

export interface XapiWriteResult {
  etag: string | null;
}

/** Identifies a State document. */
export interface XapiStateKey {
  activityId: string;
  agent: XapiAgent;
  registration?: string;
  stateId: string;
}

export type XapiStateScope = Omit<XapiStateKey, 'stateId'>;

export interface XapiAbout {
  version: string[];
  extensions?: Record<string, unknown>;
}

/** The LRS's view of one person: identifying properties, each an array. */
export interface XapiPerson {
  objectType: 'Person';
  name?: string[];
  mbox?: string[];
  mbox_sha1sum?: string[];
  openid?: string[];
  account?: Array<{ homePage: string; name: string }>;
}

export interface XapiActivity {
  objectType?: 'Activity';
  id: string;
  definition?: Record<string, unknown>;
}

/** The document sub-API shared by State, Activity Profile and Agent Profile. */
export interface XapiDocumentApi<Key, Scope> {
  get<T = unknown>(key: Key, options?: { signal?: AbortSignal }): Promise<XapiDocument<T> | null>;
  list(scope: Scope, options?: { since?: string | Date; signal?: AbortSignal }): Promise<string[]>;
  put(key: Key, content: unknown, options?: XapiWriteOptions): Promise<XapiWriteResult>;
  post(key: Key, content: unknown, options?: XapiWriteOptions): Promise<XapiWriteResult>;
  delete(key: Key, options?: XapiWriteOptions): Promise<void>;
}

export type XapiProfileKey<OwnerKey> = OwnerKey & { profileId: string };

export class XapiClient {
  readonly http: HttpClient;

  /** State documents, keyed by activity + agent (+ registration) + stateId. */
  readonly state: XapiDocumentApi<XapiStateKey, XapiStateScope>;
  /** Activity Profile documents. */
  readonly activityProfile: XapiDocumentApi<
    XapiProfileKey<{ activityId: string }>,
    { activityId: string }
  >;
  /** Agent Profile documents. */
  readonly agentProfile: XapiDocumentApi<XapiProfileKey<{ agent: XapiAgent }>, { agent: XapiAgent }>;

  constructor(opts: XapiClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);

    this.state = this.documentApi<XapiStateKey, XapiStateScope>(
      'xapi/activities/state',
      'stateId',
      (key) => ({
        activityId: key.activityId,
        agent: JSON.stringify(key.agent),
        ...(key.registration ? { registration: key.registration } : {}),
      }),
    );

    this.activityProfile = this.documentApi<
      XapiProfileKey<{ activityId: string }>,
      { activityId: string }
    >('xapi/activities/profile', 'profileId', (key) => ({ activityId: key.activityId }));

    this.agentProfile = this.documentApi<
      XapiProfileKey<{ agent: XapiAgent }>,
      { agent: XapiAgent }
    >('xapi/agents/profile', 'profileId', (key) => ({ agent: JSON.stringify(key.agent) }));
  }

  // ---- About ---------------------------------------------------------------

  /** Which xAPI versions this LRS speaks. The one resource needing no version header. */
  about(options?: { signal?: AbortSignal }): Promise<XapiAbout> {
    return this.http.get<XapiAbout>('xapi/about', options?.signal ? { signal: options.signal } : {});
  }

  // ---- Statements ----------------------------------------------------------

  /**
   * Store one statement or a batch, returning the ids assigned.
   *
   * Statements are immutable: re-sending a byte-identical statement under an id
   * already stored is a safe no-op, which makes this call retryable.
   */
  storeStatements(
    statements: XapiStatement | XapiStatement[],
    options?: XapiStoreOptions,
  ): Promise<string[]> {
    return this.http.request<string[]>({
      path: 'xapi/statements',
      method: 'POST',
      ...statementBody(statements, options),
    });
  }

  /** Store a single statement under an id you chose. */
  async putStatement(
    statementId: string,
    statement: XapiStatement,
    options?: XapiStoreOptions,
  ): Promise<void> {
    await this.http.request<void>({
      path: 'xapi/statements',
      method: 'PUT',
      query: { statementId },
      ...statementBody(statement, options),
    });
  }

  /**
   * Hash an attachment body, returning the `attachment` to declare on the
   * statement and the `body` to pass in {@link XapiStoreOptions.attachments}.
   */
  prepareAttachment(
    input: XapiAttachmentInput,
  ): Promise<{ attachment: XapiAttachment; body: XapiAttachmentBody }> {
    return prepareXapiAttachment(input);
  }

  /**
   * Like {@link getStatement}, but also downloads the stored bodies of the
   * statement's attachments (`attachments=true`).
   */
  async getStatementWithAttachments(
    statementId: string,
    options?: { format?: XapiFormat; voided?: boolean; signal?: AbortSignal },
  ): Promise<{ statement: XapiStatement; attachments: XapiAttachmentBody[] } | null> {
    const res = await nullOn404(
      this.http.raw({
        path: 'xapi/statements',
        method: 'GET',
        query: {
          ...(options?.voided ? { voidedStatementId: statementId } : { statementId }),
          ...(options?.format ? { format: options.format } : {}),
          attachments: 'true',
        },
        headers: versionHeader(),
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
    );
    if (!res) return null;
    const { json, attachments } = await readStatementResponse<XapiStatement>(res);
    return { statement: json, attachments };
  }

  /** Like {@link queryStatements}, but also downloads every referenced attachment body. */
  async queryStatementsWithAttachments(
    query: XapiStatementQuery = {},
  ): Promise<XapiStatementResult & { attachments: XapiAttachmentBody[] }> {
    const { signal, ...q } = query;
    const res = await this.http.raw({
      path: 'xapi/statements',
      method: 'GET',
      query: { ...statementQuery(q), attachments: 'true' },
      headers: versionHeader(),
      ...(signal ? { signal } : {}),
    });
    const { json, attachments } = await readStatementResponse<XapiStatementResult>(res);
    return { ...json, attachments };
  }

  /** Fetch one statement by id. Returns `null` if the LRS has no such statement. */
  async getStatement(
    statementId: string,
    options?: { format?: XapiFormat; voided?: boolean; signal?: AbortSignal },
  ): Promise<XapiStatement | null> {
    const query = options?.voided
      ? { voidedStatementId: statementId }
      : { statementId: statementId };
    return nullOn404(
      this.http.request<XapiStatement>({
        path: 'xapi/statements',
        method: 'GET',
        query: { ...query, ...(options?.format ? { format: options.format } : {}) },
        headers: versionHeader(),
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
    );
  }

  /** Query statements. Follow {@link XapiStatementResult.more} with {@link moreStatements}. */
  queryStatements(query: XapiStatementQuery = {}): Promise<XapiStatementResult> {
    const { signal, ...q } = query;
    return this.http.request<XapiStatementResult>({
      path: 'xapi/statements',
      method: 'GET',
      query: statementQuery(q),
      headers: versionHeader(),
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Fetch the next page of a query.
   *
   * The `more` link is server-built and already carries the original filters, so
   * it is resolved against the engine's origin and followed verbatim rather than
   * rebuilt — the spec is explicit that clients must not construct it.
   */
  moreStatements(
    more: string,
    options?: { signal?: AbortSignal },
  ): Promise<XapiStatementResult> {
    if (!more) {
      return Promise.resolve({ statements: [], more: '' });
    }
    return this.http.request<XapiStatementResult>({
      path: new URL(more, `${this.http.baseUrl}/`).toString(),
      method: 'GET',
      headers: versionHeader(),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * Walk every page of a query.
   *
   * `maxPages` is a guard against an unbounded walk; it defaults to 100 and the
   * iteration simply stops there, so cap it deliberately if you need more.
   */
  async *iterateStatements(
    query: XapiStatementQuery = {},
    options: { maxPages?: number } = {},
  ): AsyncGenerator<XapiStatement[], void, undefined> {
    const maxPages = options.maxPages ?? 100;
    let page = await this.queryStatements(query);
    let pages = 1;

    yield page.statements;
    while (page.more && pages < maxPages) {
      page = await this.moreStatements(
        page.more,
        query.signal ? { signal: query.signal } : undefined,
      );
      pages += 1;
      yield page.statements;
    }
  }

  // ---- Activity + Agent lookups -------------------------------------------

  /** The canonical Activity for an IRI, or `null` if this LRS has never seen it. */
  getActivity(activityId: string, options?: { signal?: AbortSignal }): Promise<XapiActivity | null> {
    return nullOn404(
      this.http.request<XapiActivity>({
        path: 'xapi/activities',
        method: 'GET',
        query: { activityId },
        headers: versionHeader(),
        ...(options?.signal ? { signal: options.signal } : {}),
      }),
    );
  }

  /** Everything the LRS knows about one agent. Always returns a Person. */
  getPerson(agent: XapiAgent, options?: { signal?: AbortSignal }): Promise<XapiPerson> {
    return this.http.request<XapiPerson>({
      path: 'xapi/agents',
      method: 'GET',
      query: { agent: JSON.stringify(agent) },
      headers: versionHeader(),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  // ---- Document resources --------------------------------------------------

  /**
   * Build the get/list/put/post/delete surface for one document resource.
   *
   * State and the two Profile resources differ only in their path, the name of
   * the document-id parameter, and how the owner is encoded into the query — so
   * they are three configurations of one implementation.
   */
  private documentApi<Key extends object, Scope extends object>(
    path: string,
    idParam: string,
    ownerQuery: (key: Key | Scope) => Record<string, string>,
  ): XapiDocumentApi<Key, Scope> {
    const http = this.http;
    const owner = ownerQuery as (key: unknown) => Record<string, string>;
    const idOf = (key: Key): string => String((key as Record<string, unknown>)[idParam]);

    return {
      async get<T = unknown>(key: Key, options?: { signal?: AbortSignal }) {
        const res = await nullOn404(
          http.raw({
            path,
            method: 'GET',
            query: { ...owner(key), [idParam]: idOf(key) },
            headers: versionHeader(),
            ...(options?.signal ? { signal: options.signal } : {}),
          }),
        );
        return res ? ((await toDocument(res)) as XapiDocument<T>) : null;
      },

      async list(scope: Scope, options?: { since?: string | Date; signal?: AbortSignal }) {
        return http.request<string[]>({
          path,
          method: 'GET',
          query: {
            ...owner(scope),
            ...(options?.since ? { since: asIso(options.since) } : {}),
          },
          headers: versionHeader(),
          ...(options?.signal ? { signal: options.signal } : {}),
        });
      },

      async put(key: Key, content: unknown, options?: XapiWriteOptions) {
        return writeDocument(http, 'PUT', path, { ...owner(key), [idParam]: idOf(key) }, content, options);
      },

      async post(key: Key, content: unknown, options?: XapiWriteOptions) {
        return writeDocument(http, 'POST', path, { ...owner(key), [idParam]: idOf(key) }, content, options);
      },

      async delete(key: Key, options?: XapiWriteOptions) {
        await http.raw({
          path,
          method: 'DELETE',
          query: { ...owner(key), [idParam]: idOf(key) },
          headers: { ...versionHeader(), ...conditionalHeaders(options) },
          ...(options?.signal ? { signal: options.signal } : {}),
        });
      },
    };
  }
}

/** Convenience factory: `createXapiClient({ baseUrl, apiKey })`. */
export function createXapiClient(opts: XapiClientOptions): XapiClient {
  return new XapiClient(opts);
}

async function writeDocument(
  http: HttpClient,
  method: 'PUT' | 'POST',
  path: string,
  query: Record<string, string>,
  content: unknown,
  options?: XapiWriteOptions,
): Promise<XapiWriteResult> {
  const isText = typeof content === 'string';
  const contentType = options?.contentType ?? (isText ? 'text/plain' : 'application/json');
  const body = isText ? (content as string) : JSON.stringify(content);

  const res = await http.raw({
    path,
    method,
    query,
    body,
    headers: {
      ...versionHeader(),
      'content-type': contentType,
      ...conditionalHeaders(options),
    },
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return { etag: res.headers.get('etag') };
}

async function toDocument(res: Response): Promise<XapiDocument> {
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const text = await res.text();
  const isJson = contentType.split(';')[0]?.trim().toLowerCase() === 'application/json';

  let content: unknown = text;
  if (isJson && text) {
    try {
      content = JSON.parse(text);
    } catch {
      // A document the LRS labelled JSON but cannot be parsed is still worth
      // handing back verbatim rather than failing the read.
      content = text;
    }
  }

  return {
    content,
    contentType,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

function statementQuery(
  q: Omit<XapiStatementQuery, 'signal'>,
): Record<string, string | number> {
  return {
    ...(q.agent ? { agent: JSON.stringify(q.agent) } : {}),
    ...(q.verb ? { verb: q.verb } : {}),
    ...(q.activity ? { activity: q.activity } : {}),
    ...(q.registration ? { registration: q.registration } : {}),
    ...(q.relatedActivities !== undefined
      ? { related_activities: String(q.relatedActivities) }
      : {}),
    ...(q.relatedAgents !== undefined ? { related_agents: String(q.relatedAgents) } : {}),
    ...(q.since ? { since: asIso(q.since) } : {}),
    ...(q.until ? { until: asIso(q.until) } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
    ...(q.ascending !== undefined ? { ascending: String(q.ascending) } : {}),
    ...(q.format ? { format: q.format } : {}),
  };
}

/** JSON when there are no attachment bodies, `multipart/mixed` when there are. */
function statementBody(
  statements: XapiStatement | XapiStatement[],
  options?: XapiStoreOptions,
): { json?: unknown; body?: BodyInit; headers: Record<string, string>; signal?: AbortSignal } {
  const signal = options?.signal ? { signal: options.signal } : {};
  if (!options?.attachments?.length) {
    return { json: statements, headers: versionHeader(), ...signal };
  }
  const upload = encodeStatementUpload(statements, options.attachments);
  return {
    body: upload.body as Uint8Array<ArrayBuffer>,
    headers: { ...versionHeader(), 'content-type': upload.contentType },
    ...signal,
  };
}

/** Parse an `attachments=true` response; tolerates a plain JSON answer. */
async function readStatementResponse<T>(
  res: Response,
): Promise<{ json: T; attachments: XapiAttachmentBody[] }> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!/^multipart\/mixed\b/i.test(contentType)) {
    return { json: (await res.json()) as T, attachments: [] };
  }
  return decodeStatementResponse<T>(new Uint8Array(await res.arrayBuffer()), contentType);
}

function versionHeader(): Record<string, string> {
  return { 'X-Experience-API-Version': XAPI_VERSION };
}

function conditionalHeaders(options?: XapiWriteOptions): Record<string, string> {
  return {
    ...(options?.ifMatch ? { 'if-match': options.ifMatch } : {}),
    ...(options?.ifNoneMatch ? { 'if-none-match': options.ifNoneMatch } : {}),
  };
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** "Not found" is a normal answer for these reads, so surface it as `null`. */
async function nullOn404<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ScormHttpError && err.status === 404) return null;
    throw err;
  }
}
