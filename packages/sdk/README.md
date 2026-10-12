# @scormflow/sdk

> Framework-agnostic TypeScript client for SCORM, xAPI, and cmi5. Pluggable transport — works with the [`scorm-engine`](https://github.com/scormflow/scorm-engine) backend, your own backend, or fully client-side via LocalStorage.

```bash
npm install @scormflow/sdk
```

## Quick start

```ts
import { ScormClient } from '@scormflow/sdk';

const client = new ScormClient({
  baseUrl: 'https://your-engine.example.com/v1',
  apiKey: process.env.SCORMFLOW_KEY!,
});

const { attemptId } = await client.attempts.start(courseId, { learnerId: 'u1' });

await client.runtime.initialize(attemptId);
await client.runtime.commit(attemptId, { 'cmi.score.raw': '85' });
await client.runtime.terminate(attemptId);
```

## Facade

`ScormClient` builds one `HttpClient` — base URL, auth, headers, retry policy,
timeouts, `onRequest` / `onResponse` interceptors — and shares it across its
namespaces:

| Namespace | Methods |
|-----------|---------|
| `client.courses` | `list()`, `get(id)`, `upload(file, { title, onProgress })`, `delete(id)` |
| `client.attempts` | `start(courseId, { learnerId, scoId, mode, restart })` |
| `client.runtime` | `initialize(attemptId)`, `commit(attemptId, values)`, `terminate(attemptId, values?)` |
| `client.analytics` | `overview()`, `course(id)`, `learner(id)` |
| `client.xapi` | the built-in LRS — see [xAPI](#xapi) |
| `client.cmi5` | cmi5 courses, registrations, launch, waive, learner preferences — see [cmi5](#cmi5) |
| `client.webhooks` | webhook endpoints, test events, delivery log — see [Webhooks](#webhooks) |
| `client.certificates` | completion certificates, PDFs, revocation, public verification — see [Certificates](#certificates) |

`client.http` (the shared `HttpClient`), `client.rest` (the `RestTransport`) and
`client.resources` (the `ResourceClient`) stay reachable for endpoints the
facade does not wrap.

Pass `transport` to run the SCORM loop somewhere other than the engine while
courses and analytics keep talking to it over REST:

```ts
import { ScormClient, LocalStorageTransport } from '@scormflow/sdk';

const client = new ScormClient({
  baseUrl: 'https://your-engine.example.com/v1',
  transport: new LocalStorageTransport(),
});
```

Every namespace is also usable standalone — `RestTransport` and
`ResourceClient` each accept either options or an existing `HttpClient`.

## Transports

| Transport | Use case | Backend required? |
|-----------|----------|-------------------|
| `RestTransport` | Default. Talks to a `scorm-engine` backend. | Yes |
| `LocalStorageTransport` | Browser-only persistence. Demos, offline learning, previews. | No |
| `MemoryTransport` | Tests and ephemeral previews. | No |

Bring your own by implementing the `ScormTransport` interface.

```ts
import type { ScormTransport } from '@scormflow/sdk';

class MyFirebaseTransport implements ScormTransport {
  async initialize(attemptId: string) { /* ... */ }
  async commit(attemptId: string, values: Record<string, unknown>) { /* ... */ }
  async terminate(attemptId: string, values?: Record<string, unknown>) { /* ... */ }
}
```

## xAPI

`client.xapi` (or a standalone `XapiClient`) covers the engine's built-in LRS:
statements, State documents, the Activity and Agent Profile resources, and the
Activity / Person lookups. The `X-Experience-API-Version` header every one of
those calls needs is added for you.

```ts
await client.xapi.storeStatements({
  actor: { mbox: 'mailto:ada@example.com' },
  verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
  object: { id: 'http://example.com/courses/intro' },
});

const page = await client.xapi.queryStatements({ agent, limit: 50 });
for await (const statements of client.xapi.iterateStatements({ agent })) {
  // `more` links are followed for you, page by page
}
```

Documents — `xapi.state`, `xapi.activityProfile` and `xapi.agentProfile` — share
one shape: `get` / `list` / `put` / `post` / `delete`. A read returns the body
*and* its `ETag`, so a safe read-modify-write is a two-liner:

```ts
const key = { activityId, agent, stateId: 'bookmark' };
const doc = await client.xapi.state.get<{ page: number }>(key);
await client.xapi.state.put(
  key,
  { page: (doc?.content.page ?? 0) + 1 },
  doc?.etag ? { ifMatch: doc.etag } : undefined,
);
```

Reading a document that does not exist returns `null` rather than throwing —
"no bookmark yet" is a normal first state, not an error. `post` merges into an
existing JSON document instead of replacing it.

## cmi5

Two halves, for the two sides of a cmi5 launch.

**LMS side — `client.cmi5`** (or a standalone `Cmi5Client`) drives the engine's
`/cmi5` surface with your API key:

```ts
const course = await client.cmi5.importCourse(zipFile); // ZIP with cmi5.xml, or a bare cmi5.xml
const reg = await client.cmi5.register({ courseId: course.id, learnerId: 'u-42' });

const { url, launchMethod } = await client.cmi5.launch(reg.id, { auId: course.aus[0].publisherId });
window.open(url); // or an <iframe> when launchMethod is 'AnyWindow'

const progress = await client.cmi5.getRegistration(reg.id); // per-AU and per-block satisfied
await client.cmi5.waive(reg.id, { auId, reason: 'Tested Out' });

// cmi5LearnerPreferences — per learner, read by every AU they launch
await client.cmi5.setLearnerPreferences({ learnerId: 'u-42' }, { languagePreference: 'fr-FR,en-US', audioPreference: 'off' });
```

`launch` is never retried — each call opens a new session and abandons the
previous one.

**AU side — `Cmi5AuSession`** runs inside the launched AU. It reads the launch
parameters, redeems the one-time fetch URL, loads `LMS.LaunchData`, and sends
the cmi5 defined statements with the session context, categories and duration
filled in. It talks to whichever LRS the launch URL names.

```ts
import { Cmi5AuSession } from '@scormflow/sdk';

const au = new Cmi5AuSession(); // reads location.href
await au.initialize();
const prefs = await au.learnerPreferences(); // { languagePreference, audioPreference } | null
if (au.launchMode === 'Normal') {
  await au.passed({ scaled: 0.92 });
  await au.completed();
}
await au.send({ verb: { id: 'http://adlnet.gov/expapi/verbs/experienced' } }); // "cmi5 allowed"
await au.terminate();
```

The session refuses, client-side, what the LMS would reject: moveOn verbs
outside Normal mode, a repeated `completed` / `passed`, a `passed` score below
the masteryScore, and anything after `terminate()`.

## Webhooks

**Manage endpoints — `client.webhooks`** (or a standalone `WebhooksClient`):

```ts
const hook = await client.webhooks.create({
  url: 'https://example.com/hooks/scormflow',
  events: ['course.completed', 'cmi5.course.satisfied'], // or ['*']
});
saveSecret(hook.secret); // shown only here and on rotateSecret()

await client.webhooks.sendTest(hook.id);                     // → the delivery, after its first attempt
const log = await client.webhooks.listDeliveries(hook.id, { status: 'FAILED' });
await client.webhooks.retryDelivery(log.data[0]!.id);        // re-send a dead-lettered delivery
```

`create`, `sendTest`, `rotateSecret` and `retryDelivery` are never retried
client-side — each one has a visible effect.

**Receive them — `constructWebhookEvent`** checks `ScormFlow-Signature` against
the raw body and parses it. It uses Web Crypto, so it runs in Node ≥ 20, Deno,
Bun and edge runtimes:

```ts
import { constructWebhookEvent, WebhookSignatureError } from '@scormflow/sdk';

export async function POST(req: Request) {
  try {
    const event = await constructWebhookEvent(
      await req.text(),                       // the raw body — verify before parsing
      req.headers.get('scormflow-signature'),
      process.env.SCORMFLOW_WEBHOOK_SECRET!,
    );
    if (event.type === 'course.completed') await markComplete(event.data);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response('bad signature', { status: 400 });
    throw err;
  }
}
```

Delivery is at-least-once; dedupe on `event.id`. `verifyWebhookSignature` is the
boolean-returning building block if you parse the body yourself.

`objective.mastered` and `xapi.statement.stored` have typed payloads — pass
`ObjectiveMasteredEventData` / `XapiStatementStoredEventData` as the type
argument once you've narrowed on `event.type`:

```ts
const event = await constructWebhookEvent<XapiStatementStoredEventData>(raw, header, secret);
if (event.type === 'xapi.statement.stored') await index(event.data.statement);
```

`certificate.issued` / `certificate.revoked` carry `CertificateEventData`.

## Certificates

The engine issues one PDF certificate per attempt, the first time the attempt
is completed and not failed. `client.certificates` (or a standalone
`CertificatesClient`) reads and manages them:

```ts
// Learner-facing — these also work with the attempt's player token
const cert = await client.certificates.forAttempt(attemptId);      // null until issued
const pdf  = await client.certificates.attemptPdf(attemptId);      // Blob
const href = client.certificates.attemptPdfUrl(attemptId, { token, download: true });

// Admin — API key
const page = await client.certificates.list({ learnerId: 'learner-42', status: 'valid' });
await client.certificates.revoke(page.data[0]!.id, 'Issued in error');
const { certificate, created } = await client.certificates.issue(attemptId); // backfill; 409 if not eligible

// Public — anyone holding the printed code
const result = await client.certificates.verify('7KQ2-M9XD-4TPA');  // null if unknown; result.valid is false once revoked
```

## Health and readiness

Neither call needs credentials. `getReadiness()` resolves on both `200` and
`503` (the engine's "not ready" answer) and never retries, so it reports the
engine's state at that moment:

```ts
const { version } = await resources.getHealth();

const ready = await resources.getReadiness();
if (ready.status === 'not_ready') {
  console.warn('engine degraded', ready.checks); // { database: 'ok', storage: 'error' }
}
```

## Errors

Typed error hierarchy:

- `ScormError` — base
- `ScormHttpError` — non-2xx response, includes status + body
  - `ScormRateLimitError` — `429`: the tenant used up its request budget; carries `retryAfterMs` and `rateLimit`
- `ScormNetworkError` — fetch / connection failure
- `ScormTimeoutError` — request exceeded timeout
- `ScormAbortError` — caller cancelled the request

Retries with exponential backoff are built in for idempotent operations on retryable HTTP status codes.

### Rate limits

When the engine runs with `RATE_LIMIT_MAX`, every tenant gets a request budget
per window. A `429` request was never processed, so the client retries it
after the server's `Retry-After`, as long as that wait is no longer than
`maxRetryAfterMs` (default 30 s). Longer waits fail fast. When retries run out,
or the wait is too long, the request rejects with a `ScormRateLimitError`:

```ts
import { ScormRateLimitError, parseRateLimit } from '@scormflow/sdk';

try {
  await client.courses.list();
} catch (err) {
  if (err instanceof ScormRateLimitError) {
    console.warn(`throttled; retry in ${err.retryAfterMs} ms`, err.rateLimit);
  }
}

// Watch the remaining budget on every response:
const http = new HttpClient({
  baseUrl, apiKey,
  maxRetryAfterMs: 10_000,
  onResponse: (res) => {
    const budget = parseRateLimit(res.headers); // { limit, remaining, resetSeconds } | null
    if (budget && budget.remaining < 10) console.warn('close to the rate limit', budget);
  },
});
```

## Status

`0.0.1` — pre-1.0, API will churn. See the [roadmap](https://github.com/scormflow/scorm-engine-client#roadmap) for what's shipped and what's planned.

## License

MIT
