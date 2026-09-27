# ScormFlow Client

> **TypeScript SDK, iframe player, and React components for SCORM, xAPI, and cmi5.**
> Pluggable transport — works with the [`@scormflow/server`](https://github.com/scormflow/scorm-engine) backend, your own backend, or fully client-side via LocalStorage. End-to-end typed.

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
import {
  ScormProvider,
  ScormPlayer,
  ScormClient,
  RestTransport,
} from '@scormflow/react';

const client = new ScormClient({
  transport: new RestTransport({
    baseUrl: 'https://your-engine.example.com',
    apiKey: process.env.NEXT_PUBLIC_SCORMFLOW_KEY!,
  }),
});

export default function CoursePage({ attemptId }: { attemptId: string }) {
  return (
    <ScormProvider client={client}>
      <ScormPlayer
        attemptId={attemptId}
        className="w-full h-screen"
        onComplete={(r) => console.log('done', r)}
        onProgress={(p) => console.log('progress', p)}
      />
    </ScormProvider>
  );
}
```

### 2. React + no backend (LocalStorage)

For demos, previews, offline learning, or "open the .zip and just play it" embeds.

```tsx
import {
  ScormProvider,
  ScormPlayer,
  ScormClient,
  LocalStorageTransport,
} from '@scormflow/react';

const client = new ScormClient({
  transport: new LocalStorageTransport({ namespace: 'demo' }),
});

<ScormProvider client={client}>
  <ScormPlayer attemptId="local-1" packageUrl="/courses/intro.zip" />
</ScormProvider>
```

### 3. Vanilla JS — drop-in player

```ts
import { mountScormPlayer } from '@scormflow/player';
import { ScormClient, RestTransport } from '@scormflow/sdk';

const client = new ScormClient({
  transport: new RestTransport({ baseUrl, apiKey }),
});

const player = mountScormPlayer({
  container: '#scorm-root',
  attemptId: 'attempt_abc',
  client,
  onComplete: (result) => console.log(result),
});
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

const client = new ScormClient({ transport: new MyFirebaseTransport(db) });
```

---

## Transports

A `ScormTransport` is the bridge between the in-browser runtime and wherever you want learner state to live. The SDK ships three; you can write your own.

| Transport | Use case | Backend required? |
|-----------|----------|-------------------|
| `RestTransport` | Default. Talks to a `@scormflow/server` backend. | Yes |
| `LocalStorageTransport` | Browser-only persistence. Demos, offline learning, embedded courses, previews. | No |
| `MemoryTransport` | Tests and ephemeral previews. State vanishes on refresh. | No |

The runtime surface (`initialize`, `commit`, `terminate`) works with **any** transport. Course management, attempt lifecycle, and analytics are REST-transport-only — they only make sense when you're using the server.

---

## React API

```tsx
// Provider
<ScormProvider client={scormClient}>
  <App />
</ScormProvider>

// Drop-in player
<ScormPlayer
  attemptId={attemptId}
  packageUrl="/courses/intro.zip"  // optional — only for client-only mode
  onComplete={(result) => ...}
  onProgress={(progress) => ...}
  onError={(err) => ...}
  className="w-full h-screen"
/>

// Hooks
const { progress, status, score, suspend, resume } = useScorm(attemptId);
const { course, isLoading } = useCourse(courseId);
const { stats } = useCourseAnalytics(courseId);
const { upload, isUploading, progress } = useScormUpload();
```

---

## SDK API (excerpt)

```ts
import { ScormClient, RestTransport } from '@scormflow/sdk';

const client = new ScormClient({
  transport: new RestTransport({ baseUrl, apiKey }),
});

// REST-transport-only
const course   = await client.courses.upload(file);
const attempt  = await client.attempts.start({ courseId, learnerId });
const stats    = await client.analytics.forCourse(courseId);

// Any transport (used by the player)
await client.runtime.initialize(attempt.id);
await client.runtime.commit(attempt.id, { 'cmi.score.raw': '85' });
await client.runtime.terminate(attempt.id);
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
- [ ] `ScormClient` top-level facade (`courses` / `attempts` / `runtime` / `analytics`)
- [ ] Automatic token refresh on `RestTransport`
- [ ] Request / response interceptors
- [ ] `@scormflow/player` — iframe mount + runtime injection (`window.API` / `window.API_1484_11`)
- [ ] Player: commit debouncing + `beforeunload` auto-save with `keepalive`
- [ ] Player: SCORM 1.2 CMI surface
- [ ] Player: SCORM 2004 CMI surface
- [ ] `@scormflow/react` — `ScormProvider` context
- [ ] `@scormflow/react` — `<ScormPlayer/>` component
- [ ] `@scormflow/react` — `useScorm`, `useCourse`, `useCourseAnalytics`, `useScormUpload` hooks
- [ ] Player UI (header, footer, progress bar, loading + error states, CSS-variable theming)
- [ ] Examples: `nextjs-app`, `vite-react`, `vanilla-html`
- [ ] First npm release for all four packages

### Phase 2 — Strong differentiators
- [ ] Offline mode — IndexedDB statement queue + reconciliation
- [ ] xAPI client surface (statements, state, activity profile)
- [ ] cmi5 client surface (launch URL parsing, AU lifecycle)
- [ ] Vue adapter — `@scormflow/vue`
- [ ] Svelte adapter — `@scormflow/svelte`
- [ ] CLI tool — `npx scormflow validate course.zip`, `extract`, `create`, `preview`
- [ ] Analytics widgets — pre-built React dashboard components
- [ ] Certificate viewer — `<ScormCertificate attemptId={id} />`

### Phase 3 — Category-defining
- [ ] Session replay viewer (`<SessionReplay attemptId={id} />`)
- [ ] AI insights widgets (BYO provider + key)
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

- [`scorm-engine`](https://github.com/scormflow/scorm-engine) — the backend. Headless runtime engine, REST API, built-in LRS (planned), analytics.
- [`scorm-engine-demo`](https://github.com/scormflow/scorm-engine-demo) — reference LMS built on both repos (planned).
