/**
 * React bindings for the LMS side of cmi5: course and registration reads, plus
 * a launch action.
 *
 * There is deliberately no AU-side hook. An AU's fetch URL works exactly once,
 * and React's StrictMode runs mount effects twice in development — a hook that
 * initialized a `Cmi5AuSession` on mount would burn the URL on the first pass
 * and fail on the second. Create the session once, outside React's lifecycle.
 */
import { useCallback, useState } from 'react';
import type {
  Cmi5Client,
  Cmi5Course,
  Cmi5LaunchRequest,
  Cmi5LaunchResult,
  Cmi5Learner,
  Cmi5LearnerPreferences,
  Cmi5Registration,
} from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** Fetch a cmi5 course with its AUs and block structure. Idle while `courseId` is falsy. */
export function useCmi5Course(
  cmi5: Cmi5Client,
  courseId: string | null | undefined,
): AsyncResource<Cmi5Course> {
  return useAsyncResource<Cmi5Course>(
    `cmi5-course:${courseId ?? ''}`,
    (signal) => cmi5.getCourse(courseId as string, { signal }),
    Boolean(courseId),
  );
}

/**
 * Fetch a registration's per-AU progress. Call `refetch` when the learner
 * returns from an AU to pick up what it reported.
 */
export function useCmi5Registration(
  cmi5: Cmi5Client,
  registrationId: string | null | undefined,
): AsyncResource<Cmi5Registration> {
  return useAsyncResource<Cmi5Registration>(
    `cmi5-registration:${registrationId ?? ''}`,
    (signal) => cmi5.getRegistration(registrationId as string, { signal }),
    Boolean(registrationId),
  );
}

/**
 * Fetch a learner's `cmi5LearnerPreferences`; `data` is null when none are
 * stored. Idle while `learner` is null. Save with `cmi5.setLearnerPreferences`,
 * then `refetch`.
 */
export function useCmi5LearnerPreferences(
  cmi5: Cmi5Client,
  learner: Cmi5Learner | null | undefined,
): AsyncResource<Cmi5LearnerPreferences | null> {
  const key = learner ? (learner.actor ? JSON.stringify(learner.actor) : `id:${learner.learnerId}`) : '';
  return useAsyncResource<Cmi5LearnerPreferences | null>(
    `cmi5-learner-preferences:${key}`,
    (signal) => cmi5.getLearnerPreferences(learner as Cmi5Learner, { signal }),
    Boolean(learner),
  );
}

export type Cmi5LaunchStatus = 'idle' | 'launching' | 'launched' | 'error';

export interface UseCmi5LaunchResult {
  /** Launch an AU; resolves with the launch URL, or null on failure (see `error`). */
  launch: (registrationId: string, request: Cmi5LaunchRequest) => Promise<Cmi5LaunchResult | null>;
  status: Cmi5LaunchStatus;
  result: Cmi5LaunchResult | null;
  error: unknown;
  reset: () => void;
}

/**
 * Launch AUs. The caller decides where the URL goes: a new window when
 * `result.launchMethod` is `OwnWindow`, otherwise an iframe works too.
 */
export function useCmi5Launch(cmi5: Cmi5Client): UseCmi5LaunchResult {
  const [status, setStatus] = useState<Cmi5LaunchStatus>('idle');
  const [result, setResult] = useState<Cmi5LaunchResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  const launch = useCallback(
    async (registrationId: string, request: Cmi5LaunchRequest): Promise<Cmi5LaunchResult | null> => {
      setStatus('launching');
      setError(null);
      setResult(null);
      try {
        const launched = await cmi5.launch(registrationId, request);
        setResult(launched);
        setStatus('launched');
        return launched;
      } catch (err) {
        setError(err);
        setStatus('error');
        return null;
      }
    },
    [cmi5],
  );

  return { launch, status, result, error, reset };
}
