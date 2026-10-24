/**
 * React bindings for course versioning: a course's releases with publish /
 * rollback / release-notes actions, and a diff between two releases. Needs a
 * client with the API key — these are admin views.
 */
import { useCallback, useState } from 'react';
import type {
  CourseVersion,
  CourseVersionDiff,
  CourseVersionList,
  CourseVersionsClient,
  PublishVersionOptions,
  VersionDiffQuery,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

export type CourseVersionAction = 'publish' | 'rollback' | 'notes';

export interface UseCourseVersionsResult extends AsyncResource<CourseVersionList> {
  /** The action in flight, if any. */
  pending: CourseVersionAction | null;
  /** The last failed action's error; cleared when the next one starts. */
  actionError: unknown;
  /** Publish a new release, then refetch the list. Resolves null on failure (see `actionError`). */
  publish: (file: Blob, options?: Omit<PublishVersionOptions, 'signal'>) => Promise<CourseVersion | null>;
  /** Make release `number` live, then refetch. */
  rollback: (number: number) => Promise<CourseVersion | null>;
  /** Replace a release's notes, then refetch. */
  updateNotes: (number: number, releaseNotes: string | null) => Promise<CourseVersion | null>;
}

/** The course's releases (newest first) plus actions. Idle while `courseId` is falsy. */
export function useCourseVersions(
  versions: CourseVersionsClient,
  courseId: string | null | undefined,
): UseCourseVersionsResult {
  const list = useAsyncResource<CourseVersionList>(
    `course-versions:${courseId ?? ''}`,
    (signal) => versions.list(courseId as string, { signal }),
    Boolean(courseId),
  );
  const [pending, setPending] = useState<CourseVersionAction | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const { refetch } = list;

  const run = useCallback(
    async (action: CourseVersionAction, call: () => Promise<CourseVersion>): Promise<CourseVersion | null> => {
      if (!courseId) return null;
      setPending(action);
      setActionError(null);
      try {
        const result = await call();
        refetch();
        return result;
      } catch (err) {
        setActionError(err);
        return null;
      } finally {
        setPending(null);
      }
    },
    [courseId, refetch],
  );

  const publish = useCallback(
    (file: Blob, options: Omit<PublishVersionOptions, 'signal'> = {}) =>
      run('publish', () => versions.publish(courseId as string, file, options)),
    [run, versions, courseId],
  );
  const rollback = useCallback(
    (number: number) => run('rollback', () => versions.rollback(courseId as string, number)),
    [run, versions, courseId],
  );
  const updateNotes = useCallback(
    (number: number, releaseNotes: string | null) =>
      run('notes', () => versions.updateNotes(courseId as string, number, releaseNotes)),
    [run, versions, courseId],
  );

  return { ...list, pending, actionError, publish, rollback, updateNotes };
}

/**
 * Diff between two releases (default: live vs the one before it). Idle while
 * `courseId` is falsy or `enabled` is false.
 */
export function useCourseVersionDiff(
  versions: CourseVersionsClient,
  courseId: string | null | undefined,
  query: VersionDiffQuery = {},
  enabled = true,
): AsyncResource<CourseVersionDiff> {
  return useAsyncResource<CourseVersionDiff>(
    `course-version-diff:${courseId ?? ''}:${query.from ?? ''}:${query.to ?? ''}`,
    (signal) => versions.diff(courseId as string, query, { signal }),
    Boolean(courseId) && enabled,
  );
}
