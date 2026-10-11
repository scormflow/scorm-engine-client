# ScormFlow · Next.js (App Router) example

Plays a SCORM course with [`@scormflow/react`](../../packages/react) inside a
Next.js App Router app.

## Run it

```bash
# from the repo root
pnpm install
pnpm --filter @scormflow/sdk --filter @scormflow/player --filter @scormflow/react build
pnpm --filter @scormflow/example-nextjs-app dev
```

Open http://localhost:3000.

Optionally preset the connection with env vars (`.env.local`):

```bash
NEXT_PUBLIC_SCORMFLOW_BASE_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_SCORMFLOW_API_KEY=sk_...
```

## Notes

- The SCORM runtime touches `window` and the DOM, so the player lives in a
  **client component** (`app/course-player.tsx`, marked `'use client'`). The
  page/layout stay server components.
- `next.config.mjs` sets `transpilePackages` for the `@scormflow/*` workspace
  packages so Next transpiles their source directly.
- The flow mirrors the other examples: `RestTransport` → `startAttempt` →
  `<ScormPlayer/>`, with commit summaries surfaced via `onCommit`.
