# @scormflow/react

> React hooks and `<ScormPlayer/>` component for ScormFlow. Drop-in SCORM support for any React app.

```bash
npm install @scormflow/react @scormflow/sdk
```

Peer deps: `react >= 18`, `react-dom >= 18`.

## Status

**Alpha.** `<ScormPlayer/>` and `useScormPlayer` are implemented and tested. APIs may
shift before `1.0`; track [the roadmap](https://github.com/scormflow/scorm-engine-client#roadmap).

## Usage

```tsx
import { ScormPlayer } from '@scormflow/react';
import { RestTransport } from '@scormflow/sdk';

const transport = new RestTransport({
  baseUrl: 'https://your-engine.example.com',
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
      transport={transport}
      style={{ width: '100%', height: '100vh' }}
      loadingFallback={<p>Loading course…</p>}
      errorFallback={(err) => <p>Failed to load: {String(err)}</p>}
      onCommit={(r) => console.log('progress', r.summary)}
    />
  );
}
```

Start (or resume) the attempt first with the SDK, then pass its `attemptId` and the SCO
`launchUrl` to the player:

```ts
const { attemptId, launch } = await transport.startAttempt(courseId, {
  learnerId: 'learner-123',
  learnerName: 'Ada Lovelace',
});
```

### No backend? Use the LocalStorage transport

```tsx
import { ScormPlayer } from '@scormflow/react';
import { LocalStorageTransport } from '@scormflow/sdk';

<ScormPlayer attemptId="local-1" launchUrl="/courses/intro/index.html" transport={new LocalStorageTransport()} />
```

## The hook

`useScormPlayer(options)` powers the component and is exported for custom layouts:

```tsx
const { containerRef, status, error, commit, terminate } = useScormPlayer({
  attemptId,
  launchUrl,
  transport,
  autoCommitMs: 10_000, // debounced background commits (0 to disable)
  onError: (err) => reportError(err),
});

// status: 'loading' | 'ready' | 'error' | 'terminated'
return <div ref={containerRef} style={{ height: 600 }} />;
```

The hook mounts the SCO for the component's lifetime, re-mounts when `attemptId` /
`launchUrl` / `transport` change, and terminates the attempt on unmount. Authoritative
CMI validation happens on the engine at commit time.

## Roadmap

Data hooks planned on top of the SDK's resource layer:

- `useCourse(courseId)` — course metadata
- `useCourseAnalytics(courseId)` — live analytics
- `useScormUpload()` — package upload with progress

## License

MIT
