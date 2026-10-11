# ScormFlow · Vanilla HTML example

The player and SDK with **no framework and no bundler** — just an ES module
import map and a `<script type="module">`.

## Run it

The import map resolves `@scormflow/sdk` / `@scormflow/player` to their built
ESM output under `packages/*/dist`, so build the packages first, then serve from
the **repo root**:

```bash
# from the repo root
pnpm install
pnpm --filter @scormflow/sdk --filter @scormflow/player build

npx serve .           # or: python3 -m http.server
# open http://localhost:3000/examples/vanilla-html/index.html
```

Serving from the repo root matters — the import map uses absolute paths
(`/packages/sdk/dist/index.js`) so the browser can find the built modules.

## What it shows

```js
import { RestTransport } from '@scormflow/sdk';
import { mountScormPlayer } from '@scormflow/player';

const transport = new RestTransport({ baseUrl, apiKey });
const attempt = await transport.startAttempt(courseId, { learnerId });

const player = await mountScormPlayer({
  container: '#scorm-root',
  attemptId: attempt.attemptId,
  launchUrl,
  transport,
  onCommit: (r) => console.log(r.summary),
});
// player.destroy() on teardown → final Terminate + cleanup
```

No build step for the app itself — `app.js` is loaded directly as a module.

## No backend?

Point the import map's `@scormflow/sdk` at the same dist and use
`LocalStorageTransport` instead of `RestTransport` to persist attempt state in
the browser.
