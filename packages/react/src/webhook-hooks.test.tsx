import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WebhooksClient } from '@scormflow/sdk';

import { useWebhookDeliveries, useWebhookEndpoints } from './use-webhooks.js';

// SSR does not run effects, so these assert the hooks' initial (pre-fetch) state
// and that they render without throwing. The fake client is never called.
const fakeWebhooks = {} as WebhooksClient;

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

function EndpointsView() {
  return <span>{state(useWebhookEndpoints(fakeWebhooks))}</span>;
}

function DeliveriesView({ endpointId }: { endpointId: string | null }) {
  return <span>{state(useWebhookDeliveries(fakeWebhooks, endpointId, { status: 'FAILED' }))}</span>;
}

describe('useWebhookEndpoints', () => {
  it('starts loading', () => {
    expect(renderToStaticMarkup(<EndpointsView />)).toContain('loading');
  });
});

describe('useWebhookDeliveries', () => {
  it('loads when given an endpoint and idles without one', () => {
    expect(renderToStaticMarkup(<DeliveriesView endpointId="w1" />)).toContain('loading');
    expect(renderToStaticMarkup(<DeliveriesView endpointId={null} />)).toContain('idle');
  });
});
