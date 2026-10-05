/**
 * React bindings for webhook administration: the endpoint list and an
 * endpoint's delivery log. Mutations (create, test, retry) are plain
 * `WebhooksClient` calls — follow them with `refetch`.
 */
import type {
  WebhookDeliveryList,
  WebhookDeliveryQuery,
  WebhookEndpoint,
  WebhooksClient,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** The tenant's webhook endpoints, newest first. */
export function useWebhookEndpoints(webhooks: WebhooksClient): AsyncResource<WebhookEndpoint[]> {
  return useAsyncResource<WebhookEndpoint[]>('webhook-endpoints', (signal) => webhooks.list({ signal }));
}

/**
 * One page of an endpoint's delivery log. Idle while `endpointId` is falsy;
 * pass `pagination.nextCursor` back as `query.before` for the next page.
 */
export function useWebhookDeliveries(
  webhooks: WebhooksClient,
  endpointId: string | null | undefined,
  query: WebhookDeliveryQuery = {},
): AsyncResource<WebhookDeliveryList> {
  const key = `webhook-deliveries:${endpointId ?? ''}:${query.status ?? ''}:${query.eventType ?? ''}:${query.limit ?? ''}:${query.before ?? ''}`;
  return useAsyncResource<WebhookDeliveryList>(
    key,
    (signal) => webhooks.listDeliveries(endpointId as string, query, { signal }),
    Boolean(endpointId),
  );
}
