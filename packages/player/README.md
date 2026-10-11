# @scormflow/player

> Iframe-based SCORM player and runtime bridge for the browser. Clean-room implementation of the SCORM 1.2 and 2004 JavaScript APIs.

```bash
npm install @scormflow/player @scormflow/sdk
```

## Status

**Alpha.** The runtime bridge and iframe player are implemented and unit-tested. APIs may still shift before `1.0`; track [the roadmap](https://github.com/scormflow/scorm-engine-client#roadmap).

## Usage

```ts
import { mountScormPlayer } from '@scormflow/player';
import { RestTransport } from '@scormflow/sdk';

const transport = new RestTransport({ baseUrl, apiKey });

// Start (or resume) an attempt, then mount the SCO.
const { attemptId, launch } = await transport.startAttempt(courseId, {
  learnerId: 'learner-123',
  learnerName: 'Ada Lovelace',
});

const player = await mountScormPlayer({
  container: '#scorm-root',
  attemptId,
  launchUrl: `${baseUrl}/courses/${courseId}/content/index.html`,
  transport,
  autoCommitMs: 10_000, // debounced background commits (0 to disable)
  onCommit: (result) => console.log('committed', result.summary),
  onError: (err) => console.error('sync failed', err),
});

// Later, when the learner leaves:
await player.destroy(); // final Terminate + cleanup
```

`mountScormPlayer` hydrates the runtime from the engine (`GET /attempts/:id/runtime`),
injects `window.API` (SCORM 1.2) or `window.API_1484_11` (SCORM 2004), and embeds the SCO
in an iframe. The SCO discovers the API via the standard parent/opener lookup walk and
behaves exactly as it would against any conformant LMS.

### How it works

The SCORM JavaScript API is synchronous (`LMSGetValue` returns immediately), but the
engine is reached over async HTTP. The bridge resolves this by:

- **hydrating** an in-memory CMI model once at initialize,
- serving every `GetValue` / `SetValue` from it **synchronously**,
- **flushing** dirty values to the engine in the background (debounced auto-commit,
  plus explicit `Commit`/`Terminate`), with commits serialized so no write is lost.

Authoritative CMI validation happens on the engine at commit time — the bridge stays
thin and reports engine-side `errors` / `warnings` via `onCommit`.

### Lower-level API

`attachScormApi(window, core)`, `RuntimeCore`, `CmiStore`, and the
`createScorm12Api` / `createScorm2004Api` factories are exported for custom
integrations that manage their own iframe or window.

## License

MIT
