import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PluginsClient, ScormClient } from '@scormflow/sdk';

import { ScormProvider, usePluginsClient } from './scorm-context.js';
import { topEventTypes, useLiveActivity, usePlugins } from './use-plugins.js';

// SSR does not run effects, so the hooks are asserted through their initial
// state; the fake fetch is never called.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const plugins = new PluginsClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

function ActivityState({ enabled }: { enabled: boolean }) {
  return <span>{state(useLiveActivity(plugins, { minutes: 15, enabled }))}</span>;
}

function PluginsState() {
  return <span>{state(usePlugins(plugins))}</span>;
}

describe('usePlugins / useLiveActivity', () => {
  it('start loading, and idle when disabled', () => {
    expect(renderToStaticMarkup(<PluginsState />)).toContain('loading');
    expect(renderToStaticMarkup(<ActivityState enabled />)).toContain('loading');
    expect(renderToStaticMarkup(<ActivityState enabled={false} />)).toContain('idle');
  });

  it('usePluginsClient returns the provided client.plugins', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    let seen: PluginsClient | undefined;
    function Probe() {
      seen = usePluginsClient();
      return null;
    }
    renderToStaticMarkup(
      <ScormProvider client={client}>
        <Probe />
      </ScormProvider>,
    );
    expect(seen).toBe(client.plugins);
  });
});

describe('topEventTypes', () => {
  it('orders by count, breaks ties by name, drops zeros and caps the list', () => {
    const totals = { 'course.completed': 3, 'attempt.started': 7, 'score.updated': 3, 'course.failed': 0 };
    expect(topEventTypes({ totals }, 2)).toEqual([
      { type: 'attempt.started', count: 7 },
      { type: 'course.completed', count: 3 },
    ]);
    expect(topEventTypes({ totals })).toHaveLength(3);
    expect(topEventTypes(null)).toEqual([]);
  });
});
