/**
 * React bindings for the engine's built-in LRS.
 *
 * Reads (`useXapiStatements`, `useXapiActivity`, `useXapiPerson`) are thin
 * wrappers over {@link useAsyncResource}, so they share its loading/error
 * handling and request cancellation.
 *
 * Documents get their own hook because they are read-modify-write, not just
 * read: `useXapiDocument` keeps the last `ETag` it saw and sends it back on the
 * next write, so a document edited elsewhere between read and write fails
 * loudly (412) instead of silently clobbering the other writer.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  XapiAgent,
  XapiActivity,
  XapiClient,
  XapiDocument,
  XapiDocumentApi,
  XapiPerson,
  XapiStatementQuery,
  XapiStatementResult,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** Query statements. Pass `enabled: false` to stay idle. */
export function useXapiStatements(
  xapi: XapiClient,
  query: XapiStatementQuery = {},
  enabled = true,
): AsyncResource<XapiStatementResult> {
  const { signal: _signal, ...rest } = query;
  return useAsyncResource<XapiStatementResult>(
    `xapi-statements:${JSON.stringify(rest)}`,
    (signal) => xapi.queryStatements({ ...rest, signal }),
    enabled,
  );
}

/** The canonical Activity for an IRI. `data` is `null` if the LRS has not seen it. */
export function useXapiActivity(
  xapi: XapiClient,
  activityId: string | null | undefined,
): AsyncResource<XapiActivity | null> {
  return useAsyncResource<XapiActivity | null>(
    `xapi-activity:${activityId ?? ''}`,
    (signal) => xapi.getActivity(activityId as string, { signal }),
    Boolean(activityId),
  );
}

/** Everything the LRS knows about one agent. Idle while `agent` is null. */
export function useXapiPerson(
  xapi: XapiClient,
  agent: XapiAgent | null | undefined,
): AsyncResource<XapiPerson> {
  return useAsyncResource<XapiPerson>(
    `xapi-person:${agent ? JSON.stringify(agent) : ''}`,
    (signal) => xapi.getPerson(agent as XapiAgent, { signal }),
    Boolean(agent),
  );
}

export interface UseXapiDocumentResult<T> extends AsyncResource<XapiDocument<T> | null> {
  /** Replace the document. Sends the last-seen ETag as `If-Match`. */
  save: (content: unknown) => Promise<void>;
  /** Merge into the document. Both sides must be JSON objects. */
  merge: (content: unknown) => Promise<void>;
  /** Delete the document. */
  remove: () => Promise<void>;
  /** True while a write is in flight. */
  saving: boolean;
  /** The error from the last write, if it failed. */
  saveError: unknown;
}

/**
 * Read and write one xAPI document — a State document or either Profile.
 *
 * Pass the matching sub-API off a client: `xapi.state`, `xapi.activityProfile`
 * or `xapi.agentProfile`. `key` must be stable across renders in value (it is
 * serialised as the cache key), not in identity.
 *
 * ```tsx
 * const bookmark = useXapiDocument(client.xapi.state, {
 *   activityId, agent, stateId: 'bookmark',
 * });
 * await bookmark.save({ page: 4 });
 * ```
 */
export function useXapiDocument<T = unknown, Key extends object = object>(
  api: XapiDocumentApi<Key, object>,
  key: Key | null | undefined,
): UseXapiDocumentResult<T> {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  // The etag of the last document we read or wrote, used as If-Match so a
  // concurrent writer cannot be overwritten unnoticed.
  const etag = useRef<string | null>(null);
  const serializedKey = key ? JSON.stringify(key) : '';

  const resource = useAsyncResource<XapiDocument<T> | null>(
    `xapi-document:${serializedKey}`,
    async (signal) => {
      const doc = await api.get<T>(key as Key, { signal });
      etag.current = doc?.etag ?? null;
      return doc;
    },
    Boolean(key),
  );

  const { refetch } = resource;

  const write = useCallback(
    async (mode: 'put' | 'post' | 'delete', content?: unknown) => {
      if (!key) throw new Error('useXapiDocument: cannot write without a key');
      setSaving(true);
      setSaveError(null);
      try {
        const options = etag.current ? { ifMatch: etag.current } : undefined;
        if (mode === 'delete') {
          await api.delete(key, options);
          etag.current = null;
        } else {
          const result = await api[mode](key, content, options);
          etag.current = result.etag;
        }
        refetch();
      } catch (err) {
        setSaveError(err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    // `api` and `key` are re-created by callers each render; the serialized key
    // is what actually identifies the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serializedKey, refetch],
  );

  const save = useCallback((content: unknown) => write('put', content), [write]);
  const merge = useCallback((content: unknown) => write('post', content), [write]);
  const remove = useCallback(() => write('delete'), [write]);

  return { ...resource, save, merge, remove, saving, saveError };
}
