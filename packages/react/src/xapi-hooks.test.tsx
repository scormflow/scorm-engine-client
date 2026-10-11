import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { XapiAgent, XapiClient, XapiDocumentApi } from '@scormflow/sdk';

import {
  useXapiActivity,
  useXapiDocument,
  useXapiPerson,
  useXapiStatements,
} from './use-xapi.js';

// SSR does not run effects, so these assert the hooks' initial (pre-fetch) state
// and that they render without throwing. The fake client is never called.
const fakeXapi = {} as XapiClient;
const fakeDocuments = {} as XapiDocumentApi<{ stateId: string }, object>;

const AGENT: XapiAgent = { mbox: 'mailto:ada@example.com' };

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

function StatementsView({ enabled }: { enabled: boolean }) {
  const { loading, data } = useXapiStatements(fakeXapi, { verb: 'completed' }, enabled);
  return <span>{state({ loading, data })}</span>;
}

function ActivityView({ activityId }: { activityId: string | null }) {
  const { loading, data } = useXapiActivity(fakeXapi, activityId);
  return <span>{state({ loading, data })}</span>;
}

function PersonView({ agent }: { agent: XapiAgent | null }) {
  const { loading, data } = useXapiPerson(fakeXapi, agent);
  return <span>{state({ loading, data })}</span>;
}

function DocumentView({ documentKey }: { documentKey: { stateId: string } | null }) {
  const { loading, data, saving, saveError } = useXapiDocument(fakeDocuments, documentKey);
  return (
    <span>
      {state({ loading, data })}:{String(saving)}:{String(saveError)}
    </span>
  );
}

describe('useXapiStatements', () => {
  it('starts loading when enabled', () => {
    expect(renderToStaticMarkup(<StatementsView enabled />)).toContain('loading');
  });

  it('stays idle when disabled', () => {
    expect(renderToStaticMarkup(<StatementsView enabled={false} />)).toContain('idle');
  });
});

describe('useXapiActivity', () => {
  it('starts loading with an activity id', () => {
    expect(renderToStaticMarkup(<ActivityView activityId="http://x/a" />)).toContain('loading');
  });

  it('stays idle without one', () => {
    expect(renderToStaticMarkup(<ActivityView activityId={null} />)).toContain('idle');
  });
});

describe('useXapiPerson', () => {
  it('starts loading with an agent', () => {
    expect(renderToStaticMarkup(<PersonView agent={AGENT} />)).toContain('loading');
  });

  it('stays idle without one', () => {
    expect(renderToStaticMarkup(<PersonView agent={null} />)).toContain('idle');
  });
});

describe('useXapiDocument', () => {
  it('starts loading with a key, and reports no write in flight', () => {
    const html = renderToStaticMarkup(<DocumentView documentKey={{ stateId: 'bookmark' }} />);
    expect(html).toContain('loading:false:null');
  });

  it('stays idle without a key', () => {
    expect(renderToStaticMarkup(<DocumentView documentKey={null} />)).toContain('idle');
  });

  it('refuses to write when it has no key', async () => {
    let api: ReturnType<typeof useXapiDocument> | null = null;
    function Probe() {
      api = useXapiDocument(fakeDocuments, null);
      return null;
    }
    renderToStaticMarkup(<Probe />);

    await expect(api!.save({ page: 1 })).rejects.toThrow(/without a key/);
  });
});
