/**
 * React bindings for session replay: one attempt's timeline, a course's
 * heatmap, and a playback clock to scrub through a timeline. Reading needs a
 * client with the API key — these are admin views, not learner ones.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttemptReplay, CourseHeatmap, HeatmapQuery, ReplayClient, ReplayTimelineEntry } from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/** The attempt's rebuilt timeline, visits and engagement score. Idle while `attemptId` is falsy. */
export function useSessionReplay(
  replay: ReplayClient,
  attemptId: string | null | undefined,
): AsyncResource<AttemptReplay> {
  return useAsyncResource<AttemptReplay>(
    `replay:${attemptId ?? ''}`,
    (signal) => replay.attempt(attemptId as string, { signal }),
    Boolean(attemptId),
  );
}

/** Per-location reach, dwell, interactions, drop-offs and pointer cells. Idle while `courseId` is falsy. */
export function useCourseHeatmap(
  replay: ReplayClient,
  courseId: string | null | undefined,
  query: HeatmapQuery = {},
): AsyncResource<CourseHeatmap> {
  const since = query.since instanceof Date ? query.since.toISOString() : (query.since ?? '');
  return useAsyncResource<CourseHeatmap>(
    `heatmap:${courseId ?? ''}:${query.limit ?? ''}:${since}`,
    (signal) => replay.courseHeatmap(courseId as string, query, { signal }),
    Boolean(courseId),
  );
}

export interface ReplayPlaybackOptions {
  /** Timeline seconds per wall-clock second. Default 10. */
  speed?: number;
  /** Clock tick in ms. Default 100. */
  tickMs?: number;
}

export interface ReplayPlayback {
  /** Seconds into the attempt. */
  position: number;
  duration: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  /** Jump to a position (clamped to the attempt). */
  seek: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  /** Index of the last entry at or before `position`, or -1 before the first. */
  currentIndex: number;
  /** The location the learner was on at `position`. */
  location: string | null;
}

/**
 * A playback clock over a replay: `play` advances `position` at `speed`
 * timeline-seconds per second until the end, and `currentIndex` / `location`
 * follow it. Starts paused at 0; resets when the replay changes.
 */
export function useReplayPlayback(
  replay: AttemptReplay | null | undefined,
  options: ReplayPlaybackOptions = {},
): ReplayPlayback {
  const duration = replay?.durationSeconds ?? 0;
  const tickMs = options.tickMs ?? 100;
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(options.speed ?? 10);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    setPosition(0);
    setPlaying(false);
  }, [replay?.attemptId, replay?.endedAt]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setPosition((p) => Math.min(durationRef.current, p + (speed * tickMs) / 1000));
    }, tickMs);
    return () => clearInterval(timer);
  }, [playing, speed, tickMs]);

  useEffect(() => {
    if (playing && position >= duration) setPlaying(false);
  }, [playing, position, duration]);

  const play = useCallback(() => {
    // Playing from the end starts over.
    setPosition((p) => (p >= durationRef.current ? 0 : p));
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((seconds: number) => {
    setPosition(Math.min(durationRef.current, Math.max(0, seconds)));
  }, []);

  const entries = replay?.entries;
  const currentIndex = useMemo(() => lastIndexAtOrBefore(entries ?? [], position), [entries, position]);
  const location = useMemo(() => locationAt(entries ?? [], currentIndex), [entries, currentIndex]);

  return { position, duration, playing, speed, play, pause, seek, setSpeed, currentIndex, location };
}

/** Index of the last entry whose offset is at or before `seconds` (entries are in time order). */
export function lastIndexAtOrBefore(entries: readonly ReplayTimelineEntry[], seconds: number): number {
  let lo = 0;
  let hi = entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.offsetSeconds <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Where the learner was after entry `index` — a `location.changed` moves them to its `to`. */
export function locationAt(entries: readonly ReplayTimelineEntry[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === 'location.changed' && typeof entry.data['to'] === 'string') return entry.data['to'];
    if (entry.location !== null) return entry.location;
  }
  return null;
}
