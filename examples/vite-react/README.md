# ScormFlow · Vite + React example

A minimal single-page app that starts (or resumes) a SCORM attempt against a
running [`scorm-engine`](https://github.com/scormflow/scorm-engine) backend and
plays the course with [`@scormflow/react`](../../packages/react).

## Run it

From the repo root (installs the workspace and builds the packages):

```bash
pnpm install
pnpm --filter @scormflow/sdk --filter @scormflow/player --filter @scormflow/react build
pnpm --filter @scormflow/example-vite-react dev
```

Then open http://localhost:5173.

## What to enter

| Field | Meaning |
| --- | --- |
| **Engine base URL** | Your engine's API root, e.g. `http://localhost:3000/api/v1` |
| **API key** | A tenant API key (`sk_…`) issued by the engine |
| **Course ID** | An uploaded course's id (from `POST /courses`) |
| **SCO launch URL** | Where the SCO's `index.html` is served |
| **Learner ID / name** | Opaque learner identity passed to the engine |

Click **Start attempt** to call `POST /courses/:id/attempts`, then the player
embeds the SCO and drives it through the engine runtime API.

## How it maps to the SDK

```ts
const transport = new RestTransport({ baseUrl, apiKey });

// Start/resume — POST /courses/:id/attempts
const { attemptId } = await transport.startAttempt(courseId, { learnerId });

// The player hydrates (GET /attempts/:id/runtime), injects window.API /
// window.API_1484_11, and batches commits (POST /attempts/:id/commit).
<ScormPlayer attemptId={attemptId} launchUrl={launchUrl} transport={transport} />
```

## No backend?

Swap `RestTransport` for `LocalStorageTransport` from `@scormflow/sdk` to persist
attempt state in the browser — handy for trying the player without a server.
