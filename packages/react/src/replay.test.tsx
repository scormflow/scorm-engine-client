import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ReplayClient,
  ScormClient,
  type AttemptReplay,
  type CourseHeatmap as CourseHeatmapData,
  type ReplayTimelineEntry,
} from '@scormflow/sdk';

import { CourseHeatmap, CourseHeatmapView } from './course-heatmap.js';
import { ScormProvider, useReplayClient } from './scorm-context.js';
import { describeReplayEntry, formatReplayTime, SessionReplay, SessionReplayView } from './session-replay.js';
import { lastIndexAtOrBefore, locationAt, useCourseHeatmap, useReplayPlayback, useSessionReplay } from './use-replay.js';

// SSR runs no effects: hooks are asserted through their initial state and the
// rendering through the presentational views.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const replayClient = new ReplayClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const entry = (offsetSeconds: number, type: string, location: string | null, data: Record<string, unknown> = {}): ReplayTimelineEntry => ({
  at: new Date(Date.parse('2026-10-16T09:00:00.000Z') + offsetSeconds * 1000).toISOString(),
  offsetSeconds,
  type,
  source: type.startsWith('attempt.') ? 'engine' : type.startsWith('page.') ? 'client' : 'content',
  location,
  data,
});

const REPLAY: AttemptReplay = {
  attemptId: 'att_1',
  courseId: 'course_1',
  learner: { id: 'learner-1', name: 'Ada Lovelace' },
  status: 'COMPLETED',
  completionStatus: 'COMPLETED',
  successStatus: 'PASSED',
  startedAt: '2026-10-16T09:00:00.000Z',
  endedAt: '2026-10-16T09:05:00.000Z',
  durationSeconds: 300,
  commits: 3,
  captured: true,
  truncated: false,
  entries: [
    entry(0, 'attempt.started', null),
    entry(10, 'location.changed', null, { from: null, to: 'slide-1' }),
    entry(100, 'location.changed', 'slide-1', { from: 'slide-1', to: 'slide-2' }),
    entry(120, 'page.hidden', 'slide-2'),
    entry(180, 'page.visible', 'slide-2'),
    entry(200, 'interaction.recorded', 'slide-2', { id: 'q1', result: 'incorrect' }),
    entry(300, 'attempt.finished', 'slide-2', { completionStatus: 'COMPLETED', successStatus: 'PASSED' }),
  ],
  visits: [
    { location: 'slide-1', enteredAt: '2026-10-16T09:00:10.000Z', leftAt: '2026-10-16T09:01:40.000Z', activeSeconds: 90 },
    { location: 'slide-2', enteredAt: '2026-10-16T09:01:40.000Z', leftAt: '2026-10-16T09:05:00.000Z', activeSeconds: 140 },
  ],
  engagement: {
    score: 72,
    level: 'high',
    components: { progress: 1, focus: 0.8, interactivity: null },
    activeSeconds: 230,
    hiddenSeconds: 60,
    idleSeconds: 0,
    focusLosses: 1,
    interactions: 1,
    locationsVisited: 2,
  },
};

const HEATMAP: CourseHeatmapData = {
  courseId: 'course_1',
  attempts: 4,
  completed: 2,
  grid: 10,
  truncated: false,
  locations: [
    { location: 'intro', visits: 4, attempts: 4, totalActiveSeconds: 240, avgActiveSeconds: 60, interactions: 0, dropOffs: 0, pointer: [] },
    {
      location: 'quiz',
      visits: 3,
      attempts: 3,
      totalActiveSeconds: 540,
      avgActiveSeconds: 180,
      interactions: 6,
      dropOffs: 2,
      pointer: [{ x: 9, y: 0, count: 5 }],
    },
  ],
};

describe('replay helpers', () => {
  it('formats times', () => {
    expect(formatReplayTime(0)).toBe('0:00');
    expect(formatReplayTime(75.9)).toBe('1:15');
    expect(formatReplayTime(3725)).toBe('1:02:05');
  });

  it('describes entries in plain English', () => {
    expect(describeReplayEntry(REPLAY.entries[2]!)).toBe('Moved to slide-2');
    expect(describeReplayEntry(REPLAY.entries[3]!)).toBe('Switched away from the tab');
    expect(describeReplayEntry(REPLAY.entries[5]!)).toBe('Answered q1 — incorrect');
    expect(describeReplayEntry(REPLAY.entries[6]!)).toBe('Finished (completed, passed)');
    expect(describeReplayEntry(entry(1, 'status.changed', null, { element: 'cmi.core.lesson_status', to: 'passed' }))).toBe(
      'lesson status → passed',
    );
    expect(describeReplayEntry(entry(1, 'score.changed', null, { raw: 80, scaled: 0.8 }))).toBe('Score 80%');
    expect(describeReplayEntry(entry(1, 'quiz.skipped', 'q3'))).toBe('quiz skipped');
  });

  it('finds the entry and location at a playhead position', () => {
    expect(lastIndexAtOrBefore(REPLAY.entries, -1)).toBe(-1);
    expect(lastIndexAtOrBefore(REPLAY.entries, 0)).toBe(0);
    expect(lastIndexAtOrBefore(REPLAY.entries, 150)).toBe(3);
    expect(lastIndexAtOrBefore(REPLAY.entries, 1000)).toBe(6);
    expect(locationAt(REPLAY.entries, 0)).toBeNull();
    // A location change moves the learner to its target, though it is filed under the old slide.
    expect(locationAt(REPLAY.entries, 2)).toBe('slide-2');
    expect(locationAt(REPLAY.entries, 1)).toBe('slide-1');
  });
});

describe('replay hooks', () => {
  it('start loading, or idle without an id', () => {
    function Probe({ id }: { id: string | null }) {
      const a = useSessionReplay(replayClient, id);
      const b = useCourseHeatmap(replayClient, id, { limit: 10 });
      return <span>{`${a.loading}:${b.loading}`}</span>;
    }
    expect(renderToStaticMarkup(<Probe id="x" />)).toContain('true:true');
    expect(renderToStaticMarkup(<Probe id={null} />)).toContain('false:false');
  });

  it('useReplayPlayback starts paused at zero', () => {
    function Probe() {
      const p = useReplayPlayback(REPLAY);
      return <span>{`${p.position}/${p.duration}:${p.playing}:${p.speed}:${p.currentIndex}:${p.location}`}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toContain('0/300:false:10:0:null');
  });

  it('useReplayClient returns the provided client.replay', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    let seen: ReplayClient | undefined;
    function Probe() {
      seen = useReplayClient();
      return null;
    }
    renderToStaticMarkup(
      <ScormProvider client={client}>
        <Probe />
      </ScormProvider>,
    );
    expect(seen).toBe(client.replay);
  });
});

describe('<SessionReplayView/>', () => {
  it('renders the engagement summary, visits strip, controls and timeline', () => {
    const html = renderToStaticMarkup(<SessionReplayView replay={REPLAY} />);
    expect(html).toContain('Session replay — Ada Lovelace');
    expect(html).toContain('data-scormflow-engagement="high"');
    expect(html).toContain('>72<');
    expect(html).toContain('focus 80%');
    expect(html).toContain('interactivity —');
    expect(html).toContain('data-scormflow-visit="slide-1"');
    expect(html).toContain('aria-label="Playback position"');
    expect(html).toContain('5:00');
    expect(html).toContain('with capture');
    expect(html.match(/data-scormflow-entry=/g)).toHaveLength(7);
    expect(html).toContain('data-scormflow-source="client"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Answered q1 — incorrect');
  });

  it('<SessionReplay/> shows its loading fallback and needs a client', () => {
    expect(renderToStaticMarkup(<SessionReplay attemptId="att_1" client={replayClient} />)).toContain('Loading replay…');
    expect(() => renderToStaticMarkup(<SessionReplay attemptId="att_1" />)).toThrow(/needs a `client` prop/);
  });
});

describe('<CourseHeatmapView/>', () => {
  it('renders one row per location with reach, time, interactions and drop-offs', () => {
    const html = renderToStaticMarkup(<CourseHeatmapView heatmap={HEATMAP} />);
    expect(html).toContain('4 attempts · 2 finished');
    expect(html).toContain('data-scormflow-heatmap-row="intro"');
    expect(html).toContain('data-scormflow-heatmap-row="quiz"');
    expect(html).toContain('75%');
    expect(html).toContain('3:00');
    // The pointer grid defaults to the first location with pointer data.
    expect(html).toContain('data-scormflow-pointer-grid="quiz"');
    expect(html).toContain('Clicks on quiz');
  });

  it('handles an empty course and the fetching wrapper', () => {
    const empty = renderToStaticMarkup(<CourseHeatmapView heatmap={{ ...HEATMAP, attempts: 0, completed: 0, locations: [] }} />);
    expect(empty).toContain('No locations reported yet.');
    expect(renderToStaticMarkup(<CourseHeatmap courseId="course_1" client={replayClient} />)).toContain('Loading heatmap…');
  });
});
