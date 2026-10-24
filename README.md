# ScormFlow Client

> **TypeScript SDK, iframe player, and React components for SCORM, xAPI, and cmi5.**
> Pluggable transport — works with the [`@scormflow/server`](https://github.com/scormflow/scorm-engine) backend, your own backend, or fully client-side via LocalStorage. End-to-end typed.

[![CI](https://github.com/scormflow/scorm-engine-client/actions/workflows/ci.yml/badge.svg)](https://github.com/scormflow/scorm-engine-client/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@scormflow/sdk.svg?label=%40scormflow%2Fsdk)](https://www.npmjs.com/package/@scormflow/sdk)
[![npm](https://img.shields.io/npm/v/@scormflow/react.svg?label=%40scormflow%2Freact)](https://www.npmjs.com/package/@scormflow/react)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.base.json)

---

## What is ScormFlow Client?

A small family of npm packages for running SCORM, xAPI, and cmi5 content inside any modern web app. The packages are designed to be **plug-and-play and decoupled** — you can use the React component, drop down to the player, or just import the SDK. You can wire them to our backend, your backend, or skip the backend entirely and persist learner state in `localStorage`.

If you're building an LMS, an internal training portal, a compliance app, a course preview tool, or anything that needs to host a SCORM/xAPI/cmi5 package and track progress — this is the toolkit.

### Highlights

- **Three packages, one stack** — `sdk`, `player`, `react`. Use one, two, or all three.
- **Pluggable transport** — `RestTransport`, `LocalStorageTransport`, `MemoryTransport` ship in the box. Bring your own (Firebase, Supabase, GraphQL, gRPC) by implementing one interface.
- **End-to-end typed** — types are generated from the backend's OpenAPI spec and published as [`@scormflow/types`](packages/types). No drift between server and client.
- **Standards-first** — SCORM 1.2, SCORM 2004, xAPI, and cmi5 share one normalized runtime surface.
- **Framework-agnostic core** — the SDK has zero React/Vue/Angular dependencies. The React package is opt-in.
- **Tiny** — target sizes: SDK < 10 KB gz, Player < 20 KB gz, React < 15 KB gz. ESM + CJS dual-build, fully tree-shakeable.

---

## Packages

| Package | What it is | npm |
|---------|------------|-----|
| [`@scormflow/sdk`](packages/sdk) | Framework-agnostic TypeScript client. Pluggable `ScormTransport` + REST / LocalStorage / Memory transports. | [`@scormflow/sdk`](https://www.npmjs.com/package/@scormflow/sdk) |
| [`@scormflow/player`](packages/player) | Iframe player + runtime bridge. Injects `window.API` (SCORM 1.2) and `window.API_1484_11` (SCORM 2004). Vanilla JS, no React required. | [`@scormflow/player`](https://www.npmjs.com/package/@scormflow/player) |
| [`@scormflow/react`](packages/react) | React hooks + `<ScormPlayer/>` component + `<ScormProvider/>`. | [`@scormflow/react`](https://www.npmjs.com/package/@scormflow/react) |
| [`@scormflow/types`](packages/types) | TypeScript types generated from the backend's OpenAPI spec. | [`@scormflow/types`](https://www.npmjs.com/package/@scormflow/types) |
| [`@scormflow/client`](packages/client) | Umbrella package — SDK at the root, player / React / types on subpaths (`@scormflow/client/react`, …). One install. | [`@scormflow/client`](https://www.npmjs.com/package/@scormflow/client) |

---

## Install

Pick the package that matches how you're embedding SCORM. The React package depends on the SDK and the player — install just `@scormflow/react` if you're building a React app:

```bash
npm install @scormflow/react
# or
pnpm add @scormflow/react
# or
yarn add @scormflow/react
```

Other entrypoints:

```bash
# Vanilla / non-React app
npm install @scormflow/sdk @scormflow/player

# SDK only (write your own UI)
npm install @scormflow/sdk
```

Requirements: Node ≥ 20 for tooling. The runtime works in any evergreen browser.

---

## Quick Start

### 1. React + our backend

```tsx
import { ScormPlayer } from '@scormflow/react';
import { ScormClient } from '@scormflow/sdk';

const client = new ScormClient({
  baseUrl: 'https://your-engine.example.com/v1',
  apiKey: process.env.NEXT_PUBLIC_SCORMFLOW_KEY!,
});

export default function CoursePage({
  attemptId,
  launchUrl,
}: {
  attemptId: string;
  launchUrl: string;
}) {
  return (
    <ScormPlayer
      attemptId={attemptId}
      launchUrl={launchUrl}
      transport={client.runtime}
      className="w-full h-screen"
      onCommit={(r) => console.log('committed', r.summary)}
      onError={(err) => console.error(err)}
    />
  );
}
```

### 2. React + no backend (LocalStorage)

For demos, previews, offline learning, or "open the .zip and just play it" embeds.

```tsx
import { ScormPlayer } from '@scormflow/react';
import { LocalStorageTransport } from '@scormflow/sdk';

const transport = new LocalStorageTransport({ namespace: 'demo' });

<ScormPlayer
  attemptId="local-1"
  launchUrl="/courses/intro/index.html"
  transport={transport}
/>;
```

### 3. Vanilla JS — drop-in player

```ts
import { mountScormPlayer } from '@scormflow/player';
import { ScormClient } from '@scormflow/sdk';

const client = new ScormClient({ baseUrl, apiKey });

const player = await mountScormPlayer({
  container: '#scorm-root',
  attemptId: 'attempt_abc',
  launchUrl: '/courses/intro/index.html',
  transport: client.runtime,
  onCommit: (result) => console.log(result),
});

// later: await player.commit() / await player.destroy()
```

### 4. Bring your own backend

Implement the `ScormTransport` interface against Firebase, Supabase, GraphQL, gRPC, or anything else. The player and React layer depend only on this interface — never on the REST transport.

```ts
import type { ScormTransport } from '@scormflow/sdk';

class MyFirebaseTransport implements ScormTransport {
  async initialize(attemptId: string) { /* ... */ }
  async commit(attemptId: string, values: Record<string, unknown>) { /* ... */ }
  async terminate(attemptId: string, values?: Record<string, unknown>) { /* ... */ }
}

// Hand it straight to the player…
const transport = new MyFirebaseTransport(db);
<ScormPlayer attemptId={attemptId} launchUrl={launchUrl} transport={transport} />;

// …or plug it into the facade's runtime namespace, keeping REST for the rest.
const client = new ScormClient({ baseUrl, transport });
```

---

## Transports

A `ScormTransport` is the bridge between the in-browser runtime and wherever you want learner state to live. The SDK ships three; you can write your own.

| Transport | Use case | Backend required? |
|-----------|----------|-------------------|
| `RestTransport` | Default. Talks to a `@scormflow/server` backend. | Yes |
| `LocalStorageTransport` | Browser-only persistence. Demos, offline learning, embedded courses, previews. | No |
| `MemoryTransport` | Tests and ephemeral previews. State vanishes on refresh. | No |
| `OfflineTransport` | Wraps `RestTransport` for flaky or no connectivity: queues commits durably, syncs on reconnect. | Yes (eventually) |

### Offline sync

```ts
const transport = new OfflineTransport({
  remote: new RestTransport({ baseUrl, token: () => attemptToken, retries: 1 }),
  onConflict: (attemptId, commits) => console.warn('attempt finished elsewhere', commits),
});
```

Every commit gets a strictly increasing `seq` and is written to `localStorage`
(or any `StorageLike`) before it is sent with `POST /attempts/{id}/sync`. If the
engine is unreachable the SCO keeps running — `commit` resolves with
`queued: true` — and the queue is flushed on the next commit, on the browser's
`online` event, or by calling `transport.flush(attemptId)`. The engine skips any
`seq` it has already applied, so a flush whose response was lost is just resent.
Once an attempt has been opened online, `initialize` also works offline from the
cached snapshot. Commits that arrive after the attempt was finished on another
device are reported to `onConflict` and dropped (server state wins).
`useOfflineSync(transport, attemptId)` gives React a `{ pending, syncing, flush }` view.

The runtime surface (`initialize`, `commit`, `terminate`) works with **any** transport. Course management, attempt lifecycle, and analytics are REST-transport-only — they only make sense when you're using the server.

---

## React API

```tsx
// Drop-in player
<ScormPlayer
  attemptId={attemptId}
  launchUrl={launchUrl}
  transport={transport}          // any ScormTransport, e.g. client.runtime
  autoCommitMs={10_000}          // debounced background commit; 0 disables
  onCommit={(result) => ...}
  onError={(err) => ...}
  loadingFallback={<Spinner />}
  errorFallback={(err) => <ErrorBox error={err} />}
  className="w-full h-screen"
/>

// Hooks
const { containerRef, status, error, player, commit, terminate } =
  useScormPlayer({ attemptId, launchUrl, transport });
// The data hooks take a ResourceClient — `client.resources` off the facade.
const { data: course, loading, error, refetch } = useCourse(client.resources, courseId);
const { data: stats } = useCourseAnalytics(client.resources, courseId);
const { upload, status, progress, result, reset } = useScormUpload(client.resources);

// Certificate viewer — reads the client from <ScormProvider> (or pass `client`)
<ScormCertificate attemptId={attemptId} token={playerToken} />

// Live engine events (admin tooling — needs an API key)
const { events, status } = useEngineEvents(client.events, { types: ['course.completed'] });

// Live per-minute activity from the engine's analytics plugin (admin tooling)
const { data: activity } = useLiveActivity(client.plugins, { minutes: 15 });

// AI insights with the tenant's own provider (admin tooling) — generates only on click
<AiInsightPanel courseId={courseId} kind="recommendations" renderText={(md) => <Markdown>{md}</Markdown>} />
const { insight, loading, error, generate } = useAiInsight(client.ai);
const { data: usage } = useAiUsage(client.ai);

// Session replay (admin tooling): play / scrub an attempt, see where a course loses learners
<SessionReplay attemptId={attemptId} speed={20} />
<CourseHeatmap courseId={courseId} limit={100} />

// Opt the learner-facing player in to capture (memoize the option object)
const replay = useMemo(
  () => ({ recorder: new ReplayRecorder({ replay: client.replay, attemptId }), pointer: true }),
  [attemptId],
);
<ScormPlayer attemptId={attemptId} launchUrl={launchUrl} transport={client.runtime} replay={replay} />
```

> Wrap the tree in `<ScormProvider client={client}>` and hooks / components can
> resolve the client from context (`useScormClient()`, `useCertificatesClient()`, …).

---

## SDK API (excerpt)

```ts
import { ScormClient } from '@scormflow/sdk';

const client = new ScormClient({ baseUrl, apiKey });

// REST-only — these need the server
const courses  = await client.courses.list();
const course   = await client.courses.upload(file, { onProgress: (p) => ... });
const attempt  = await client.attempts.start(course.id, { learnerId });
const overview = await client.analytics.overview();
const stats    = await client.analytics.course(course.id);

// cmi5 — the engine is the LMS; the AU talks to its LRS directly
const reg      = await client.cmi5.register({ courseId: cmi5Course.id, learnerId });
const { url }  = await client.cmi5.launch(reg.id, { auId: cmi5Course.aus[0].id });
// …and inside the AU: new Cmi5AuSession().initialize(), passed(), completed(), terminate()

// xAPI attachments — hash the body, declare it, send both as multipart/mixed
const cert     = await client.xapi.prepareAttachment({ usageType, display, contentType: 'application/pdf', content: pdfBlob });
await client.xapi.storeStatements({ ...statement, attachments: [cert.attachment] }, { attachments: [cert.body] });
const { attachments } = await client.xapi.queryStatementsWithAttachments({ verb });

// Webhooks — register an endpoint, then verify deliveries in your receiver
const hook     = await client.webhooks.create({ url: hookUrl, events: ['course.completed'] });
// receiver: await constructWebhookEvent(rawBody, req.headers.get('scormflow-signature'), hook.secret)

// Certificates — issued by the engine when an attempt completes without failing
const mine     = await client.certificates.forAttempt(attempt.attemptId);   // null until issued
const pdf      = await client.certificates.attemptPdf(attempt.attemptId);   // Blob
const check    = await client.certificates.verify('7KQ2-M9XD-4TPA');        // public; null if unknown

// Live events — Server-Sent Events, same payload as a webhook, auto-reconnect
const stream   = client.events.stream({ types: ['course.completed'], onEvent: (e) => console.log(e.data) });
stream.close();

// Plugins — what the engine has installed, and the analytics plugin's live counts
const installed = await client.plugins.list();
const activity = await client.plugins.activity({ minutes: 15 });

// AI analytics — bring your own provider + key (engine needs AI_MASTER_KEY)
await client.ai.setProvider('default', { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey, monthlyTokenCap: 2_000_000 });
const check    = await client.ai.testProvider({ provider: 'openai', model: 'gpt-5', apiKey });   // stores nothing
const insight  = await client.ai.generate({ kind: 'insights', courseId: course.id });         // never retried
const usage    = await client.ai.usage();                                                     // tokens, cost, cap status
const csv      = await client.ai.callsCsv({ limit: 1000 });                                  // audit log export

// Session replay — timelines are rebuilt from commits; capture events are opt-in extras
const timeline = await client.replay.attempt(attempt.attemptId);   // entries, visits, engagement score
const heatmap  = await client.replay.courseHeatmap(course.id, { limit: 100 });
const recorder = new ReplayRecorder({ replay: client.replay, attemptId: attempt.attemptId });
recorder.navigate('slide-3');                                      // batched, retried, deduped by id
recorder.record('quiz.skipped', { data: { question: 'q4' } });
await recorder.stop();                                             // flush what's left

// Any transport (this is what the player drives)
await client.runtime.initialize(attempt.attemptId);
await client.runtime.commit(attempt.attemptId, { 'cmi.score.raw': '85' });
await client.runtime.terminate(attempt.attemptId);
```

Pass `transport` to run the runtime loop off-server (`LocalStorageTransport`,
`MemoryTransport`, or your own) while courses and analytics still use REST:

```ts
const client = new ScormClient({ baseUrl, transport: new LocalStorageTransport() });
```

Errors are typed: `ScormHttpError`, `ScormNetworkError`, `ScormTimeoutError`, `ScormAbortError`. Retries with exponential backoff are built in for idempotent operations.

---

## How it fits together

```
┌─────────────────────────────────────────────────────────────┐
│  Your app (React / Next.js / Vite / vanilla)                │
│                                                             │
│   @scormflow/react   ──►   @scormflow/player   ──►          │
│        ▲                       (iframe + window.API)        │
│        │                                                    │
│   @scormflow/sdk         ◄── ScormTransport ──►   Backend   │
│                                                  (any)      │
└─────────────────────────────────────────────────────────────┘
```

- The runtime bridge is a **clean-room implementation** of the SCORM 1.2 and 2004 JavaScript APIs. No third-party SCORM libraries are bundled.
- Because we follow the spec, **any spec-compliant course works** — including content authored with pipwerks, scorm-again, Captivate, Storyline, Lectora, iSpring, Articulate Rise, etc. We don't maintain a compatibility matrix; the spec is the contract.

---

## Roadmap

Checkboxes reflect the actual state of `main`.

### Phase 1 — MVP
- [x] Monorepo (pnpm workspaces) + TypeScript strict
- [x] `@scormflow/types` package + generation from OpenAPI
- [x] `@scormflow/sdk` package skeleton (ESM + CJS + .d.ts)
- [x] `ScormTransport` interface
- [x] `RestTransport` implementation
- [x] `LocalStorageTransport` implementation
- [x] `MemoryTransport` implementation
- [x] HTTP client with retry + exponential backoff
- [x] Typed error hierarchy (`ScormError`, `ScormHttpError`, `ScormNetworkError`, ...)
- [x] Unit tests (Vitest) for transports + HTTP client
- [x] `ResourceClient` — courses + analytics REST surface, upload with progress
- [x] `ScormClient` top-level facade (`courses` / `attempts` / `runtime` / `analytics` / `xapi` / `cmi5` / `webhooks` / `certificates` / `events` / `plugins` / `ai` / `replay`)
- [x] Request / response interceptors (`onRequest` / `onResponse` on `HttpClient`)
- [x] Automatic token refresh on `RestTransport` (`onUnauthorized` callback refreshes the token on a 401 and retries once; `TokenProvider` still supported)
- [x] `@scormflow/player` — iframe mount + runtime injection (`window.API` / `window.API_1484_11`)
- [x] Player: commit debouncing + `beforeunload` auto-save
- [x] Player: SCORM 1.2 CMI surface
- [x] Player: SCORM 2004 CMI surface
- [x] `@scormflow/react` — `ScormProvider` context (`useScormClient` + typed namespace hooks)
- [x] `@scormflow/react` — `<ScormPlayer/>` component
- [x] `@scormflow/react` — `useScormPlayer`, `useCourse`, `useCourseAnalytics`, `useScormUpload` hooks
- [x] `@scormflow/react` — `useXapiStatements`, `useXapiDocument`, `useXapiActivity`, `useXapiPerson` hooks
- [x] Player UI (header, footer, progress bar, loading + error states, CSS-variable theming)
- [x] Examples: `nextjs-app`, `vite-react`, `vanilla-html`
- [x] First npm release for all four packages (`@scormflow/types`, `@scormflow/sdk`, `@scormflow/player`, `@scormflow/react`)

### Phase 2 — Strong differentiators
- [x] Offline SCORM commits — `OfflineTransport` (durable seq-numbered queue, `/sync` reconciliation, offline resume) + `useOfflineSync`
- [ ] Offline xAPI — IndexedDB-backed statement queue + reconciliation
- [x] xAPI client surface (statements, state, activity + agent profiles, activity/person lookups)
- [x] xAPI attachments (`prepareAttachment`, multipart statement upload, `…WithAttachments` reads)
- [x] cmi5 LMS surface (`client.cmi5`: courses, registrations, launch, waive) + React hooks
- [x] cmi5 AU runtime (`Cmi5AuSession`: launch-parameter parsing, fetch URL, LaunchData, AU lifecycle)
- [x] cmi5 block satisfaction + `cmi5LearnerPreferences` (LMS + AU side, React hook)
- [x] Webhooks client (`client.webhooks`), receiver-side signature verification, delivery-log React hooks
- [ ] Vue adapter — `@scormflow/vue`
- [ ] Svelte adapter — `@scormflow/svelte`
- [ ] CLI tool — `npx scormflow validate course.zip`, `extract`, `create`, `preview`
- [ ] Analytics widgets — pre-built React dashboard components
- [x] Certificate viewer — `<ScormCertificate attemptId={id} />`, `client.certificates`, `useCertificate` / `useCertificates`
- [x] Live engine events — `client.events.stream()` (SSE over `fetch`, auto-reconnect) + `useEngineEvents`
- [x] Engine plugins — `client.plugins` (list, any plugin's routes, analytics plugin's live activity) + `useLiveActivity` / `usePlugins`

### Phase 3 — Category-defining
- [x] Session replay — `client.replay` (timelines, course heatmaps), opt-in capture (`ReplayRecorder`, `attachReplayCapture`, `replay` option on the player), `<SessionReplay/>`, `<CourseHeatmap/>`, `useSessionReplay` / `useCourseHeatmap` / `useReplayPlayback`
- [x] AI insights (BYO provider + key) — `client.ai` (provider configs, key test, insights, usage, call log + CSV), `<AiInsightPanel/>`, `useAiInsight` / `useAiUsage` / `useAiProviders` / `useAiCalls`
- [ ] AI provider settings UI (config form, usage meter)
- [ ] A11y — keyboard nav, screen reader announcements, focus management
- [ ] i18n — built-in locale support for player UI
- [ ] Course version diff viewer
- [ ] Universal content gateway client (SCORM / xAPI / cmi5 / H5P / HTML / video / PDF)

---

## Development

```bash
pnpm install
pnpm types:generate    # regenerate @scormflow/types from ../scorm-engine/openapi/openapi.yaml
pnpm build             # build all packages
pnpm dev               # watch all packages in parallel
pnpm typecheck
pnpm test
```

Each package has its own `build`, `dev`, `typecheck`, `test` scripts that the root delegates to via `pnpm -r --filter './packages/*'`.

---

## Contributing

Issues and PRs welcome. Before opening a PR:

- Run `pnpm typecheck && pnpm test` at the root.
- Match the existing style.
- New SDK surface area should ship with a test.
- The OpenAPI spec lives in the backend repo — if you need a type that doesn't exist yet, open a PR there first and we'll regenerate.

---

## License

MIT — see [LICENSE](LICENSE).

## Related repos

- [`scorm-engine`](https://github.com/scormflow/scorm-engine) — the backend. Headless runtime engine, REST API, built-in LRS, cmi5, webhooks, analytics.
- [`scorm-engine-demo`](https://github.com/scormflow/scorm-engine-demo) — reference LMS built on both repos (planned).
