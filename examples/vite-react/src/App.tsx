import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { RestTransport, type CommitResult, type StartAttemptResult } from '@scormflow/sdk';
import { ScormPlayer } from '@scormflow/react';

interface Config {
  baseUrl: string;
  apiKey: string;
  courseId: string;
  learnerId: string;
  learnerName: string;
  launchUrl: string;
}

const DEFAULT_CONFIG: Config = {
  baseUrl: 'http://localhost:3000/api/v1',
  apiKey: '',
  courseId: '',
  learnerId: 'demo-learner',
  learnerName: 'Demo Learner',
  launchUrl: '',
};

export function App(): JSX.Element {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [attempt, setAttempt] = useState<StartAttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCommit, setLastCommit] = useState<string>('—');

  // Stable transport identity — the player re-mounts if this changes, so we only
  // rebuild it when the connection details change.
  const transport = useMemo(
    () =>
      new RestTransport({
        baseUrl: config.baseUrl,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      }),
    [config.baseUrl, config.apiKey],
  );

  const field = (key: keyof Config) => (e: ChangeEvent<HTMLInputElement>) =>
    setConfig((c) => ({ ...c, [key]: e.target.value }));

  async function startAttempt(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await transport.startAttempt(config.courseId, {
        learnerId: config.learnerId,
        ...(config.learnerName ? { learnerName: config.learnerName } : {}),
      });
      setAttempt(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function stop(): void {
    setAttempt(null);
    setLastCommit('—');
  }

  function onCommit(result: CommitResult): void {
    const s = result.summary;
    setLastCommit(
      s
        ? `completion=${s.completionStatus} success=${s.successStatus} score=${s.scoreScaled ?? '—'}`
        : 'committed',
    );
  }

  const canStart = config.courseId.trim() !== '' && config.learnerId.trim() !== '' && !busy;

  return (
    <main className="app">
      <header>
        <h1>ScormFlow</h1>
        <p className="subtitle">Vite + React example</p>
      </header>

      {!attempt ? (
        <section className="panel">
          <h2>1. Connect &amp; start an attempt</h2>
          <div className="grid">
            <Labeled label="Engine base URL">
              <input value={config.baseUrl} onChange={field('baseUrl')} placeholder="http://localhost:3000/api/v1" />
            </Labeled>
            <Labeled label="API key">
              <input value={config.apiKey} onChange={field('apiKey')} placeholder="sk_…" type="password" />
            </Labeled>
            <Labeled label="Course ID">
              <input value={config.courseId} onChange={field('courseId')} placeholder="course_…" />
            </Labeled>
            <Labeled label="SCO launch URL">
              <input value={config.launchUrl} onChange={field('launchUrl')} placeholder="https://…/index.html" />
            </Labeled>
            <Labeled label="Learner ID">
              <input value={config.learnerId} onChange={field('learnerId')} />
            </Labeled>
            <Labeled label="Learner name">
              <input value={config.learnerName} onChange={field('learnerName')} />
            </Labeled>
          </div>
          <button className="primary" disabled={!canStart} onClick={() => void startAttempt()}>
            {busy ? 'Starting…' : 'Start attempt'}
          </button>
          {error && <p className="error">Error: {error}</p>}
        </section>
      ) : (
        <section className="panel">
          <div className="playerHeader">
            <div>
              <h2>2. Playing</h2>
              <p className="meta">
                attempt <code>{attempt.attemptId}</code> · {attempt.version} ·{' '}
                {attempt.resumed ? 'resumed' : 'new'} · entry <code>{attempt.entry ?? '—'}</code>
              </p>
              <p className="meta">last commit: {lastCommit}</p>
            </div>
            <button onClick={stop}>Stop</button>
          </div>

          {config.launchUrl ? (
            <ScormPlayer
              attemptId={attempt.attemptId}
              launchUrl={config.launchUrl}
              transport={transport}
              className="player"
              onCommit={onCommit}
              onError={(err) => setError(err instanceof Error ? err.message : String(err))}
              loadingFallback={<p className="loading">Loading course…</p>}
              errorFallback={(err) => <p className="error">Player error: {String(err)}</p>}
            />
          ) : (
            <p className="error">Set a SCO launch URL to embed the content.</p>
          )}
        </section>
      )}

      <footer>
        <p>
          Backend-less demo? Swap <code>RestTransport</code> for{' '}
          <code>LocalStorageTransport</code> from <code>@scormflow/sdk</code>.
        </p>
      </footer>
    </main>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="labeled">
      <span>{label}</span>
      {children}
    </label>
  );
}
