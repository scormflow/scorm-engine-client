import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScormClient } from '@scormflow/sdk';

import {
  ScormProvider,
  useResourceClient,
  useScormClient,
  useXapiClient,
} from './scorm-context.js';

// A structurally-faithful stand-in; the hooks only read references off it.
const fakeClient = {
  resources: { tag: 'resources' },
  runtime: { tag: 'runtime' },
  xapi: { tag: 'xapi' },
  cmi5: { tag: 'cmi5' },
  webhooks: { tag: 'webhooks' },
} as unknown as ScormClient;

function ClientProbe() {
  const client = useScormClient();
  const resources = useResourceClient();
  const xapi = useXapiClient();
  return (
    <span>
      {String(client === fakeClient)}:{(resources as unknown as { tag: string }).tag}:
      {(xapi as unknown as { tag: string }).tag}
    </span>
  );
}

describe('ScormProvider', () => {
  it('exposes the client and its namespaces to descendants', () => {
    const html = renderToStaticMarkup(
      <ScormProvider client={fakeClient}>
        <ClientProbe />
      </ScormProvider>,
    );
    expect(html).toContain('true:resources:xapi');
  });

  it('throws a helpful error when used outside a provider', () => {
    expect(() => renderToStaticMarkup(<ClientProbe />)).toThrow(/within a <ScormProvider>/);
  });
});
