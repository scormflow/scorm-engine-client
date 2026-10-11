/**
 * cmi5 support, in two halves.
 *
 *  - {@link Cmi5Client} is the **LMS side**: import courses, register learners,
 *    launch AUs and read progress, against the engine's `/cmi5` REST surface.
 *    It authenticates with the tenant API key like the rest of the SDK.
 *
 *  - {@link Cmi5AuSession} is the **AU side**: the code that runs *inside* a
 *    launched assignable unit. It reads the launch parameters, redeems the
 *    one-time fetch URL, loads `LMS.LaunchData`, and sends the cmi5 defined
 *    statements with the context the spec requires. It talks to whatever LRS
 *    the launch URL names — nothing in it is specific to this engine.
 */
import { ScormError, ScormHttpError } from './errors.js';
import { HttpClient, type FetchLike, type HttpClientOptions } from './http/http-client.js';
import { XAPI_VERSION, type XapiAgent, type XapiStatement } from './xapi.js';

// ---------------------------------------------------------------------------
// Spec constants
// ---------------------------------------------------------------------------

export const CMI5_VERBS = {
  launched: 'http://adlnet.gov/expapi/verbs/launched',
  initialized: 'http://adlnet.gov/expapi/verbs/initialized',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  abandoned: 'https://w3id.org/xapi/adl/verbs/abandoned',
  waived: 'https://w3id.org/xapi/adl/verbs/waived',
  terminated: 'http://adlnet.gov/expapi/verbs/terminated',
  satisfied: 'https://w3id.org/xapi/adl/verbs/satisfied',
} as const;

export const CMI5_CATEGORY = {
  cmi5: 'https://w3id.org/xapi/cmi5/context/categories/cmi5',
  moveOn: 'https://w3id.org/xapi/cmi5/context/categories/moveon',
} as const;

export const CMI5_SESSION_EXTENSION = 'https://w3id.org/xapi/cmi5/context/extensions/sessionid';

export type Cmi5MoveOn = 'Passed' | 'Completed' | 'CompletedAndPassed' | 'CompletedOrPassed' | 'NotApplicable';
export type Cmi5LaunchMode = 'Normal' | 'Browse' | 'Review';
export type Cmi5LaunchMethod = 'AnyWindow' | 'OwnWindow';
export type Cmi5WaiveReason = 'Tested Out' | 'Equivalent AU' | 'Equivalent Outside Activity' | 'Administrative';

/** Agent Profile id of the learner's language / audio preferences. */
export const CMI5_LEARNER_PREFERENCES_PROFILE_ID = 'cmi5LearnerPreferences';

/** The `cmi5LearnerPreferences` Agent Profile document. */
export interface Cmi5LearnerPreferences {
  /** Comma-separated RFC 5646 language codes, most preferred first. */
  languagePreference?: string;
  audioPreference?: 'on' | 'off';
}

// ---------------------------------------------------------------------------
// LMS side
// ---------------------------------------------------------------------------

export interface Cmi5Au {
  id: string;
  publisherId: string;
  activityId: string;
  title: string;
  description: string | null;
  url: string;
  launchMethod: Cmi5LaunchMethod;
  moveOn: Cmi5MoveOn;
  masteryScore: number | null;
  activityType: string | null;
  launchParameters: string | null;
}

export type Cmi5StructureNode =
  | { type: 'au'; id: string }
  | {
      type: 'block';
      id: string;
      /** Engine-generated activity IRI, the object of the block's `satisfied` statement. */
      activityId?: string;
      title: string;
      description: string | null;
      children: Cmi5StructureNode[];
    };

export interface Cmi5Course {
  id: string;
  publisherId: string;
  activityId: string;
  title: string;
  description: string | null;
  /** True when the engine hosts the package files. */
  hosted: boolean;
  aus: Cmi5Au[];
  structure: Cmi5StructureNode[];
  createdAt: string;
  updatedAt: string;
}

export interface Cmi5CourseList {
  data: Cmi5Course[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

export interface Cmi5ValidationReport {
  valid: boolean;
  errors: Array<{ code: string; message: string }>;
  structure: Record<string, unknown> | null;
}

export interface Cmi5AuProgress {
  id: string;
  publisherId: string;
  title: string;
  moveOn: Cmi5MoveOn;
  completed: boolean;
  passed: boolean;
  failed: boolean;
  waived: boolean;
  satisfied: boolean;
}

export interface Cmi5BlockProgress {
  publisherId: string;
  title: string;
  /** True once every AU and nested block in it is satisfied. */
  satisfied: boolean;
  satisfiedAt: string | null;
}

export interface Cmi5Registration {
  id: string;
  courseId: string;
  actor: XapiAgent;
  satisfied: boolean;
  satisfiedAt: string | null;
  createdAt: string;
  aus: Cmi5AuProgress[];
  /** Every block in the course, in document order. */
  blocks: Cmi5BlockProgress[];
}

/** A learner, named by a full xAPI actor or by an id in the engine's account namespace. */
export type Cmi5Learner =
  | { actor: XapiAgent; learnerId?: never; learnerName?: never }
  | { learnerId: string; learnerName?: string; actor?: never };

export type Cmi5RegistrationRequest = { courseId: string; learnerPreferences?: Cmi5LearnerPreferences } & Cmi5Learner;

export interface Cmi5LaunchRequest {
  /** Engine id or publisher id of the AU. */
  auId: string;
  launchMode?: Cmi5LaunchMode;
  returnUrl?: string;
}

export interface Cmi5LaunchResult {
  /** Open this. In a new window when `launchMethod` is `OwnWindow`. */
  url: string;
  sessionId: string;
  launchMode: Cmi5LaunchMode;
  launchMethod: Cmi5LaunchMethod;
  expiresAt: string;
}

type Signal = { signal?: AbortSignal };

const sig = (o?: Signal) => (o?.signal ? { signal: o.signal } : {});
const enc = encodeURIComponent;

export class Cmi5Client {
  readonly http: HttpClient;

  constructor(opts: HttpClientOptions | HttpClient) {
    this.http = opts instanceof HttpClient ? opts : new HttpClient(opts);
  }

  listCourses(options?: Signal): Promise<Cmi5CourseList> {
    return this.http.get<Cmi5CourseList>('cmi5/courses', sig(options));
  }

  getCourse(courseId: string, options?: Signal): Promise<Cmi5Course> {
    return this.http.get<Cmi5Course>(`cmi5/courses/${enc(courseId)}`, sig(options));
  }

  /** Import a ZIP with `cmi5.xml` at its root, or a bare `cmi5.xml` with absolute AU urls. */
  importCourse(file: Blob, options: { title?: string } & Signal = {}): Promise<Cmi5Course> {
    const form = new FormData();
    form.append('file', file);
    if (options.title) form.append('title', options.title);
    return this.http.request<Cmi5Course>({ path: 'cmi5/courses', method: 'POST', body: form, ...sig(options) });
  }

  validateCourse(file: Blob, options?: Signal): Promise<Cmi5ValidationReport> {
    const form = new FormData();
    form.append('file', file);
    return this.http.request<Cmi5ValidationReport>({
      path: 'cmi5/courses/validate',
      method: 'POST',
      body: form,
      ...sig(options),
    });
  }

  deleteCourse(courseId: string): Promise<void> {
    return this.http.delete<void>(`cmi5/courses/${enc(courseId)}`);
  }

  register(body: Cmi5RegistrationRequest, options?: Signal): Promise<Cmi5Registration> {
    return this.http.post<Cmi5Registration>('cmi5/registrations', body, sig(options));
  }

  getRegistration(registrationId: string, options?: Signal): Promise<Cmi5Registration> {
    return this.http.get<Cmi5Registration>(`cmi5/registrations/${enc(registrationId)}`, sig(options));
  }

  /**
   * Launch an AU. Not retried: each call opens a new session and abandons the
   * previous one, so a blind retry would be visible in the learner's record.
   */
  launch(registrationId: string, body: Cmi5LaunchRequest, options?: Signal): Promise<Cmi5LaunchResult> {
    return this.http.post<Cmi5LaunchResult>(`cmi5/registrations/${enc(registrationId)}/launch`, body, {
      retries: 0,
      ...sig(options),
    });
  }

  waive(
    registrationId: string,
    body: { auId: string; reason: Cmi5WaiveReason },
    options?: Signal,
  ): Promise<Cmi5Registration> {
    return this.http.post<Cmi5Registration>(`cmi5/registrations/${enc(registrationId)}/waive`, body, sig(options));
  }

  /** A learner's `cmi5LearnerPreferences`, or null when none are stored. */
  async getLearnerPreferences(learner: Cmi5Learner, options?: Signal): Promise<Cmi5LearnerPreferences | null> {
    const query = learner.actor ? { agent: JSON.stringify(learner.actor) } : { learnerId: learner.learnerId };
    try {
      return await this.http.get<Cmi5LearnerPreferences>('cmi5/learner-preferences', { query, ...sig(options) });
    } catch (err) {
      if (err instanceof ScormHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** Replace a learner's `cmi5LearnerPreferences`. They apply to every course the learner launches. */
  setLearnerPreferences(
    learner: Cmi5Learner,
    preferences: Cmi5LearnerPreferences,
    options?: Signal,
  ): Promise<Cmi5LearnerPreferences> {
    return this.http.put<Cmi5LearnerPreferences>(
      'cmi5/learner-preferences',
      { ...learner, ...preferences },
      sig(options),
    );
  }
}

// ---------------------------------------------------------------------------
// AU side
// ---------------------------------------------------------------------------

/** The five query parameters an LMS appends to an AU's launch URL. */
export interface Cmi5LaunchParams {
  endpoint: string;
  fetch: string;
  actor: XapiAgent;
  registration: string;
  activityId: string;
}

/**
 * Read the cmi5 launch parameters from a URL (defaults to `location.href`).
 * Throws a {@link Cmi5Error} naming the first one missing.
 */
export function parseCmi5Launch(url?: string | URL): Cmi5LaunchParams {
  const source = url ?? (typeof location !== 'undefined' ? location.href : undefined);
  if (!source) throw new Cmi5Error('No launch URL to read cmi5 parameters from');
  const params = new URL(source).searchParams;

  const read = (name: string): string => {
    const value = params.get(name);
    if (!value) throw new Cmi5Error(`Launch URL is missing the "${name}" parameter`);
    return value;
  };

  let actor: XapiAgent;
  try {
    actor = JSON.parse(read('actor')) as XapiAgent;
  } catch (err) {
    if (err instanceof Cmi5Error) throw err;
    throw new Cmi5Error('Launch URL "actor" parameter is not valid JSON');
  }

  return {
    endpoint: read('endpoint'),
    fetch: read('fetch'),
    actor,
    registration: read('registration'),
    activityId: read('activityId'),
  };
}

/** The `LMS.LaunchData` state document. */
export interface Cmi5LaunchData {
  contextTemplate: {
    contextActivities?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
  };
  launchMode: Cmi5LaunchMode;
  moveOn: Cmi5MoveOn;
  launchParameters?: string;
  masteryScore?: number;
  returnURL?: string;
  entitlementKey?: { courseStructure?: string; alternate?: string };
}

export interface Cmi5Score {
  /** In [0, 1]. Required on passed / failed when the AU has a masteryScore. */
  scaled?: number;
  raw?: number;
  min?: number;
  max?: number;
}

export interface Cmi5AuSessionOptions {
  /** Defaults to {@link parseCmi5Launch} on the current location. */
  launch?: Cmi5LaunchParams;
  fetch?: FetchLike;
  /** Clock override for tests. */
  now?: () => number;
  /** Statement id generator override for tests. */
  uuid?: () => string;
}

export type Cmi5AuStatus = 'idle' | 'initialized' | 'terminated';

export class Cmi5Error extends ScormError {
  override readonly name = 'Cmi5Error';
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

/**
 * Runtime for code running inside a cmi5 AU.
 *
 * ```ts
 * const au = new Cmi5AuSession();
 * await au.initialize();           // fetch token, load LaunchData, send `initialized`
 * await au.passed({ scaled: 0.9 });
 * await au.completed();
 * await au.terminate();
 * ```
 *
 * The session refuses, client-side, what the LMS would reject: moveOn verbs
 * outside Normal mode, a second `completed` or `passed`, a `passed` score
 * below the masteryScore, and anything after `terminate()`.
 */
export class Cmi5AuSession {
  readonly launch: Cmi5LaunchParams;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly now: () => number;
  private readonly uuid: () => string;

  private lrs: HttpClient | null = null;
  private data: Cmi5LaunchData | null = null;
  private startedAt = 0;
  private state: Cmi5AuStatus = 'idle';
  private sentCompleted = false;
  private sentPassed = false;

  constructor(options: Cmi5AuSessionOptions = {}) {
    this.launch = options.launch ?? parseCmi5Launch();
    this.fetchImpl = options.fetch;
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  }

  get status(): Cmi5AuStatus {
    return this.state;
  }

  /** The LaunchData the LMS wrote. Available after {@link initialize}. */
  get launchData(): Cmi5LaunchData {
    if (!this.data) throw new Cmi5Error('Call initialize() first');
    return this.data;
  }

  get launchMode(): Cmi5LaunchMode {
    return this.launchData.launchMode;
  }

  get masteryScore(): number | null {
    return this.launchData.masteryScore ?? null;
  }

  get sessionId(): string {
    return String(this.launchData.contextTemplate.extensions?.[CMI5_SESSION_EXTENSION] ?? '');
  }

  /** Redeem the fetch URL, load LaunchData, and send `initialized`. */
  async initialize(): Promise<void> {
    if (this.state !== 'idle') throw new Cmi5Error('Session is already initialized');

    const token = await this.redeemFetchUrl();
    this.lrs = new HttpClient({
      baseUrl: this.launch.endpoint,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      headers: { Authorization: `Basic ${token}`, 'X-Experience-API-Version': XAPI_VERSION },
    });

    this.data = await this.lrs.get<Cmi5LaunchData>('activities/state', {
      query: {
        activityId: this.launch.activityId,
        agent: JSON.stringify(this.launch.actor),
        registration: this.launch.registration,
        stateId: 'LMS.LaunchData',
      },
    });

    this.startedAt = this.now();
    await this.sendDefined(CMI5_VERBS.initialized, 'initialized');
    this.state = 'initialized';
  }

  async completed(): Promise<void> {
    this.requireMoveOnAllowed();
    if (this.sentCompleted) throw new Cmi5Error('completed was already sent in this session');
    await this.sendDefined(CMI5_VERBS.completed, 'completed', {
      moveOn: true,
      result: { completion: true, duration: this.duration() },
    });
    this.sentCompleted = true;
  }

  async passed(score?: Cmi5Score): Promise<void> {
    this.requireMoveOnAllowed();
    if (this.sentPassed) throw new Cmi5Error('passed was already sent in this session');
    const mastery = this.masteryScore;
    if (mastery !== null) {
      if (score?.scaled === undefined) throw new Cmi5Error('passed needs score.scaled when the AU has a masteryScore');
      if (score.scaled < mastery) throw new Cmi5Error(`score ${score.scaled} is below the masteryScore ${mastery}`);
    }
    await this.sendDefined(CMI5_VERBS.passed, 'passed', {
      moveOn: true,
      result: { success: true, duration: this.duration(), ...(score ? { score } : {}) },
    });
    this.sentPassed = true;
  }

  async failed(score?: Cmi5Score): Promise<void> {
    this.requireMoveOnAllowed();
    const mastery = this.masteryScore;
    if (mastery !== null && score?.scaled !== undefined && score.scaled >= mastery) {
      throw new Cmi5Error(`score ${score.scaled} meets the masteryScore ${mastery}; send passed`);
    }
    await this.sendDefined(CMI5_VERBS.failed, 'failed', {
      moveOn: true,
      result: { success: false, duration: this.duration(), ...(score ? { score } : {}) },
    });
  }

  /** Send `terminated` and close the session. Further calls throw. */
  async terminate(): Promise<void> {
    this.requireLive();
    await this.sendDefined(CMI5_VERBS.terminated, 'terminated', {
      result: { duration: this.duration() },
    });
    this.state = 'terminated';
  }

  /**
   * Send a "cmi5 allowed" statement — any verb other than the cmi5 defined ones,
   * e.g. `answered` or `experienced`. The session context is filled in; the
   * object defaults to the AU itself.
   */
  async send(statement: {
    verb: { id: string; display?: Record<string, string> };
    object?: unknown;
    result?: Record<string, unknown>;
    context?: { extensions?: Record<string, unknown>; contextActivities?: Record<string, unknown> };
  }): Promise<string> {
    this.requireLive();
    if (Object.values(CMI5_VERBS).includes(statement.verb.id as never)) {
      throw new Cmi5Error('Use the dedicated method for cmi5 defined verbs');
    }
    const template = this.launchData.contextTemplate;
    const full = this.baseStatement(statement.verb, {
      contextActivities: { ...template.contextActivities, ...statement.context?.contextActivities },
      extensions: { ...template.extensions, ...statement.context?.extensions },
    });
    if (statement.object !== undefined) full.object = statement.object;
    if (statement.result) full.result = statement.result;
    await this.post(full);
    return full.id as string;
  }

  /**
   * The learner's `cmi5LearnerPreferences` from the LRS, or null when the LMS
   * stored none. Use them to pick a language and decide whether to play audio.
   */
  async learnerPreferences(): Promise<Cmi5LearnerPreferences | null> {
    if (!this.lrs) throw new Cmi5Error('Call initialize() first');
    try {
      return await this.lrs.get<Cmi5LearnerPreferences>('agents/profile', {
        query: { agent: JSON.stringify(this.launch.actor), profileId: CMI5_LEARNER_PREFERENCES_PROFILE_ID },
      });
    } catch (err) {
      if (err instanceof ScormHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** ISO 8601 duration since `initialize()`. */
  duration(): string {
    const seconds = Math.max(0, (this.now() - this.startedAt) / 1000);
    return `PT${Math.round(seconds * 100) / 100}S`;
  }

  // ---- internals -----------------------------------------------------------

  private async redeemFetchUrl(): Promise<string> {
    // A fetch URL works once, so a transparent retry could burn it: no retries.
    const http = new HttpClient({
      baseUrl: this.launch.fetch,
      retries: 0,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
    let body: { 'auth-token'?: string };
    try {
      body = await http.request<{ 'auth-token'?: string }>({ path: this.launch.fetch, method: 'POST' });
    } catch (err) {
      const detail =
        err instanceof ScormHttpError
          ? (err.body as { 'error-text'?: string } | undefined)?.['error-text']
          : undefined;
      throw new Cmi5Error(`Could not redeem the fetch URL${detail ? `: ${detail}` : ''}`, err);
    }
    if (!body?.['auth-token']) throw new Cmi5Error('Fetch URL returned no auth-token');
    return body['auth-token'];
  }

  private async sendDefined(
    verb: string,
    display: string,
    extra: { moveOn?: boolean; result?: Record<string, unknown> } = {},
  ): Promise<void> {
    const template = this.launchData.contextTemplate;
    const category: Array<{ objectType: string; id: string }> = [
      { objectType: 'Activity', id: CMI5_CATEGORY.cmi5 },
    ];
    if (extra.moveOn) category.push({ objectType: 'Activity', id: CMI5_CATEGORY.moveOn });
    const statement = this.baseStatement(
      { id: verb, display: { 'en-US': display } },
      {
        contextActivities: { ...template.contextActivities, category },
        extensions: { ...template.extensions },
      },
    );
    if (extra.result) statement.result = extra.result;
    await this.post(statement);
  }

  private baseStatement(
    verb: { id: string; display?: Record<string, string> },
    context: { contextActivities: Record<string, unknown>; extensions: Record<string, unknown> },
  ): XapiStatement {
    return {
      id: this.uuid(),
      actor: this.launch.actor,
      verb,
      object: { objectType: 'Activity', id: this.launch.activityId },
      context: { registration: this.launch.registration, ...context },
      timestamp: new Date(this.now()).toISOString(),
    };
  }

  private async post(statement: XapiStatement): Promise<void> {
    if (!this.lrs) throw new Cmi5Error('Call initialize() first');
    await this.lrs.post<string[]>('statements', statement);
  }

  private requireLive(): void {
    if (this.state !== 'initialized') {
      throw new Cmi5Error(this.state === 'idle' ? 'Call initialize() first' : 'Session is terminated');
    }
  }

  private requireMoveOnAllowed(): void {
    this.requireLive();
    if (this.launchMode !== 'Normal') {
      throw new Cmi5Error(`completed, passed and failed are not allowed in ${this.launchMode} mode`);
    }
  }
}
