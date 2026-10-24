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

## Data hooks

Built on the SDK's `ResourceClient` (courses + analytics). Construct one client
and pass it to the hooks:

```tsx
import { ResourceClient } from '@scormflow/sdk';
import { useCourse, useCourseAnalytics, useScormUpload } from '@scormflow/react';

const resources = new ResourceClient({ baseUrl, apiKey });

function CourseCard({ courseId }: { courseId: string }) {
  const { data: course, loading, error, refetch } = useCourse(resources, courseId);
  const { data: stats } = useCourseAnalytics(resources, courseId);
  if (loading) return <Spinner />;
  if (error) return <Error onRetry={refetch} />;
  return <h3>{course!.title} — {Math.round((stats?.completionRate ?? 0) * 100)}% complete</h3>;
}

function Uploader() {
  const { upload, status, progress } = useScormUpload(resources);
  return (
    <input
      type="file"
      accept=".zip"
      onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      disabled={status === 'uploading'}
    />
  );
  // status: 'idle' | 'uploading' | 'success' | 'error'; progress: 0..1
}
```

- `useCourse(resources, courseId)` / `useCourseAnalytics(resources, courseId)` —
  return `{ data, loading, error, refetch }`; pass a falsy `courseId` to stay idle.
- `useScormUpload(resources)` — `{ upload, status, progress, result, error, reset }`;
  reports real upload progress via XHR in the browser.

## xAPI hooks

Built on the SDK's `XapiClient` — the engine's built-in LRS.

```tsx
import { XapiClient } from '@scormflow/sdk';
import { useXapiStatements, useXapiDocument } from '@scormflow/react';

const xapi = new XapiClient({ baseUrl, apiKey });
const agent = { mbox: 'mailto:ada@example.com' };

function Timeline() {
  const { data, loading } = useXapiStatements(xapi, { agent, limit: 20 });
  if (loading) return <Spinner />;
  return <ul>{data!.statements.map((s) => <li key={s.id}>{s.verb.id}</li>)}</ul>;
}

function Bookmark({ activityId }: { activityId: string }) {
  const doc = useXapiDocument<{ page: number }>(xapi.state, {
    activityId,
    agent,
    stateId: 'bookmark',
  });
  return (
    <button onClick={() => doc.save({ page: (doc.data?.content.page ?? 0) + 1 })} disabled={doc.saving}>
      Page {doc.data?.content.page ?? 0}
    </button>
  );
}
```

- `useXapiStatements(xapi, query, enabled?)` — `{ data, loading, error, refetch }`.
- `useXapiActivity(xapi, activityId)` / `useXapiPerson(xapi, agent)` — idle while
  the argument is falsy; `data` is `null` for an activity the LRS has never seen.
- `useXapiDocument(api, key)` — read/write one document. Pass `xapi.state`,
  `xapi.activityProfile` or `xapi.agentProfile` as `api`. Returns the resource
  fields plus `{ save, merge, remove, saving, saveError }`.

  Writes send the last-seen `ETag` as `If-Match`, so a document changed by
  someone else between your read and your write fails with a 412 instead of
  quietly overwriting them.

## cmi5 hooks

LMS-side hooks over the SDK's `Cmi5Client` (`client.cmi5`).

```tsx
import { useCmi5Course, useCmi5Launch, useCmi5Registration } from '@scormflow/react';

function Syllabus({ courseId, registrationId }: { courseId: string; registrationId: string }) {
  const { data: course } = useCmi5Course(client.cmi5, courseId);
  const { data: reg, refetch } = useCmi5Registration(client.cmi5, registrationId);
  const { launch, status } = useCmi5Launch(client.cmi5);

  const open = async (auId: string) => {
    const result = await launch(registrationId, { auId });
    if (result) window.open(result.url);
  };

  return (
    <ul onFocus={refetch}>
      {course?.aus.map((au) => (
        <li key={au.id}>
          {au.title} {reg?.aus.find((p) => p.id === au.id)?.satisfied ? '✓' : ''}
          <button disabled={status === 'launching'} onClick={() => open(au.id)}>Launch</button>
        </li>
      ))}
    </ul>
  );
}
```

There is no AU-side hook on purpose: a cmi5 fetch URL works once, and StrictMode
runs mount effects twice. Create the SDK's `Cmi5AuSession` once, outside React.

`registration.blocks` reports per-block satisfaction alongside `registration.aus`.
`useCmi5LearnerPreferences(client.cmi5, { learnerId })` reads a learner's
`cmi5LearnerPreferences` (`data` is `null` when none are stored); save with
`client.cmi5.setLearnerPreferences`, then `refetch`.

## Webhook hooks

For an admin screen over the SDK's `WebhooksClient` (`client.webhooks`):

```tsx
import { useWebhookDeliveries, useWebhookEndpoints } from '@scormflow/react';

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const { data: endpoints } = useWebhookEndpoints(client.webhooks);
  const { data: log, refetch } = useWebhookDeliveries(client.webhooks, endpointId, { status: 'FAILED' });

  return (
    <ul>
      {log?.data.map((d) => (
        <li key={d.id}>
          {d.eventType} — {d.lastError ?? d.status}
          <button onClick={() => client.webhooks.retryDelivery(d.id).then(refetch)}>Retry</button>
        </li>
      ))}
    </ul>
  );
}
```

Page through older deliveries by passing `log.pagination.nextCursor` as `before`.

## Live events

`useEngineEvents` keeps a live feed of engine events over the SDK's
`EventsClient` (`client.events`) — newest first, capped at `limit`:

```tsx
import { useEngineEvents } from '@scormflow/react';

function Activity() {
  const { events, status } = useEngineEvents(client.events, {
    types: ['course.completed', 'certificate.issued'],
    limit: 20,
    onEvent: () => refetchCompletions(),   // e.g. refresh a list
  });
  return (
    <section>
      <p>Live: {status}</p>
      <ul>{events.map((e) => <li key={e.id}>{e.type} · {e.createdAt}</li>)}</ul>
    </section>
  );
}
```

It connects on mount, reconnects on its own, and closes on unmount or when
`enabled` turns false. The stream needs a tenant API key, so this belongs in
admin tooling whose `client` talks to your backend — not in a learner-facing page.

## Live activity (analytics plugin)

When the engine runs the `analytics` plugin, `useLiveActivity` polls its
per-minute event counts — a cheap "what is happening right now" panel:

```tsx
import { isPluginMissing } from '@scormflow/sdk';
import { topEventTypes, useLiveActivity } from '@scormflow/react';

function NowPanel() {
  const { data, error } = useLiveActivity(client.plugins, { minutes: 15, refreshIntervalMs: 10_000 });
  if (isPluginMissing(error)) return <p>Turn on the engine's analytics plugin.</p>;
  if (!data) return null;
  return (
    <ul>
      {topEventTypes(data, 3).map(({ type, count }) => <li key={type}>{type}: {count}</li>)}
    </ul>
  );
}
```

The previous report stays in `data` while a refresh runs; `refreshIntervalMs: 0`
fetches once. `usePlugins(client.plugins)` lists the installed plugins, and
`usePluginsClient()` reads `client.plugins` from `<ScormProvider>`. Both need the
API key — admin tooling only.

## Certificates

`<ScormCertificate/>` shows one attempt's completion certificate with a PDF
download, reading `client.certificates` from `<ScormProvider>` (or a `client`
prop). It shows `pendingFallback` until the engine has issued one — that
happens on the commit that completes the attempt.

```tsx
import { ScormCertificate } from '@scormflow/react';

<ScormCertificate
  attemptId={attemptId}
  token={playerToken}          // optional: makes the download a plain link
  locale="en-GB"
  pendingFallback="Finish the course to earn your certificate."
/>
```

Without `token`, the download fetches the PDF through the client and saves it.
Colors follow the same `--scormflow-*` CSS variables as `<ScormPlayer/>`.

For custom layouts, `useCertificate(client.certificates, attemptId)` returns
the certificate (`data` is `null` until issued; `refetch` after completion),
`useCertificates(client.certificates, query)` pages the tenant's list, and
`<ScormCertificateView certificate={…} />` is the presentational card on its own.

## License

MIT
