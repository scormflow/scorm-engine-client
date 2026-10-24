/**
 * React binding for the engine's live event stream: the latest events, newest
 * first, and the connection state. Meant for admin dashboards — the stream
 * needs a tenant API key, so the `EventsClient` should talk to your own
 * backend (or run in a trusted, server-rendered admin tool), never ship a
 * key to learners.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  EngineEventStreamStatus,
  EventsClient,
  WebhookEventType,
  WebhookPayload,
} from '@scormflow/sdk';

export interface UseEngineEventsOptions {
  /** Only these event types; every type when omitted. */
  types?: readonly WebhookEventType[];
  /** Connect only while true. Default true. */
  enabled?: boolean;
  /** How many recent events to keep. Default 50. */
  limit?: number;
  /** Called for every event as it arrives (e.g. to refetch a list or show a toast). */
  onEvent?: (event: WebhookPayload) => void;
}

export interface UseEngineEventsResult {
  /** Recent events, newest first, at most `limit`. */
  events: WebhookPayload[];
  lastEvent: WebhookPayload | null;
  /** `idle` while disabled. */
  status: EngineEventStreamStatus | 'idle';
  /** The last connection error; cleared when the stream (re)opens. */
  error: unknown;
  /** Forget the events received so far. */
  clear: () => void;
}

/** Prepend `event` to `list`, newest first, capped at `limit`, ignoring an id already present. */
export function appendEngineEvent(
  list: readonly WebhookPayload[],
  event: WebhookPayload,
  limit: number,
): WebhookPayload[] {
  if (list.some((e) => e.id === event.id)) return list as WebhookPayload[];
  return [event, ...list].slice(0, Math.max(1, limit));
}

export function useEngineEvents(client: EventsClient, options: UseEngineEventsOptions = {}): UseEngineEventsResult {
  const { enabled = true, limit = 50 } = options;
  const typesKey = options.types ? [...options.types].sort().join(',') : '';
  const [events, setEvents] = useState<WebhookPayload[]>([]);
  const [status, setStatus] = useState<UseEngineEventsResult['status']>(enabled ? 'connecting' : 'idle');
  const [error, setError] = useState<unknown>(null);

  const onEvent = useRef(options.onEvent);
  onEvent.current = options.onEvent;
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    setStatus('connecting');
    const stream = client.stream({
      ...(typesKey ? { types: typesKey.split(',') as WebhookEventType[] } : {}),
      onEvent: (event) => {
        setEvents((list) => appendEngineEvent(list, event, limitRef.current));
        onEvent.current?.(event);
      },
      onStatus: (s) => {
        setStatus(s);
        if (s === 'open') setError(null);
      },
      onError: setError,
    });
    return () => stream.close();
  }, [client, enabled, typesKey]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, lastEvent: events[0] ?? null, status, error, clear };
}
