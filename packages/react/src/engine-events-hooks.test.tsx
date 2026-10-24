import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EventsClient, WebhookPayload } from '@scormflow/sdk';

import { appendEngineEvent, useEngineEvents } from './use-engine-events.js';

// SSR does not run effects, so the fake client is never asked to connect; these
// assert the hook's initial state. The list logic is tested directly.
const fakeEvents = {} as EventsClient;

function Feed({ enabled }: { enabled?: boolean }) {
  const { status, events, lastEvent } = useEngineEvents(fakeEvents, {
    types: ['course.completed'],
    ...(enabled === undefined ? {} : { enabled }),
  });
  return (
    <span>
      {status}:{events.length}:{lastEvent ? lastEvent.id : 'none'}
    </span>
  );
}

const evt = (id: string): WebhookPayload => ({
  id,
  type: 'course.completed',
  createdAt: '2026-10-13T09:00:00.000Z',
  data: {},
});

describe('useEngineEvents', () => {
  it('starts connecting with no events, or idle when disabled', () => {
    expect(renderToStaticMarkup(<Feed />)).toContain('connecting:0:none');
    expect(renderToStaticMarkup(<Feed enabled={false} />)).toContain('idle:0:none');
  });
});

describe('appendEngineEvent', () => {
  it('keeps the newest first, capped at the limit', () => {
    let list: WebhookPayload[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = appendEngineEvent(list, evt(id), 3);
    expect(list.map((e) => e.id)).toEqual(['d', 'c', 'b']);
  });

  it('ignores an event it already holds, returning the same list', () => {
    const list = appendEngineEvent([], evt('a'), 10);
    expect(appendEngineEvent(list, evt('a'), 10)).toBe(list);
  });

  it('keeps at least one event even with a zero limit', () => {
    expect(appendEngineEvent([], evt('a'), 0)).toHaveLength(1);
  });
});
