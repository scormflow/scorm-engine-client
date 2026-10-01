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
timeouts, `onRequest` / `onResponse` interceptors — and shares it across four
namespaces:

| Namespace | Methods |
|-----------|---------|
| `client.courses` | `list()`, `get(id)`, `upload(file, { title, onProgress })`, `delete(id)` |
| `client.attempts` | `start(courseId, { learnerId, scoId, mode, restart })` |
| `client.runtime` | `initialize(attemptId)`, `commit(attemptId, values)`, `terminate(attemptId, values?)` |
| `client.analytics` | `overview()`, `course(id)`, `learner(id)` |

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

## Errors

Typed error hierarchy:

- `ScormError` — base
- `ScormHttpError` — non-2xx response, includes status + body
- `ScormNetworkError` — fetch / connection failure
- `ScormTimeoutError` — request exceeded timeout
- `ScormAbortError` — caller cancelled the request

Retries with exponential backoff are built in for idempotent operations on retryable HTTP status codes.

## Status

`0.0.1` — pre-1.0, API will churn. See the [roadmap](https://github.com/scormflow/scorm-engine-client#roadmap) for what's shipped and what's planned.

## License

MIT
