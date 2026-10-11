import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfflineTransport, ScormNetworkError, type SyncCapableTransport } from '@scormflow/sdk';

import { useOfflineSync } from './use-offline-sync.js';

// SSR does not run effects, so this asserts the hook's initial state is read
// synchronously from the transport's durable queue.
function offlineTransport(): OfflineTransport {
  const map = new Map<string, string>();
  const remote = {
    initialize: async () => ({ attemptId: 'a1', version: 'SCORM_1_2', cmi: {}, lastCommitSeq: null }),
    commit: async () => ({ ok: true }),
    terminate: async () => undefined,
    sync: async () => {
      throw new ScormNetworkError('offline');
    },
  } as unknown as SyncCapableTransport;
  return new OfflineTransport({
    remote,
    flushOnOnline: false,
    storage: {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    },
  });
}

function SyncBadge({ transport, attemptId }: { transport: OfflineTransport; attemptId: string | null }) {
  const { pending, syncing } = useOfflineSync(transport, attemptId);
  return <span>{`${pending}:${syncing ? 'syncing' : 'idle'}`}</span>;
}

describe('useOfflineSync', () => {
  it('reports queued commits for the attempt', async () => {
    const transport = offlineTransport();
    await transport.initialize('a1');
    await transport.commit('a1', { 'cmi.core.lesson_location': 'p1' });
    await transport.commit('a1', { 'cmi.core.lesson_location': 'p2' });
    expect(renderToStaticMarkup(<SyncBadge transport={transport} attemptId="a1" />)).toContain('2:idle');
  });

  it('reports nothing without an attempt', () => {
    expect(renderToStaticMarkup(<SyncBadge transport={offlineTransport()} attemptId={null} />)).toContain('0:idle');
  });
});
