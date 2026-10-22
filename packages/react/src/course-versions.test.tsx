import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourseVersionsClient, ScormClient, type CourseVersionDiff } from '@scormflow/sdk';

import {
  CourseVersionDiffView,
  CourseVersionHistory,
  describeVersionDiff,
  formatVersionDate,
} from './course-versions.js';
import { formatBytes } from './package-validation.js';
import { ScormProvider } from './scorm-context.js';
import { useCourseVersionDiff, useCourseVersions } from './use-course-versions.js';

// SSR runs no effects or event handlers: hooks are asserted through their
// initial state and the rendering through the presentational diff view.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const versions = new CourseVersionsClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const DIFF: CourseVersionDiff = {
  from: { number: 1, label: '1.0' },
  to: { number: 2, label: '2.0' },
  identical: false,
  metadata: [{ field: 'masteryScore', from: 75, to: 80 }],
  scos: {
    added: [{ identifier: 'ITEM-3', title: 'Wrap-up', launchHref: 'c.html', parameters: null }],
    removed: [{ identifier: 'ITEM-2', title: 'Quiz', launchHref: 'b.html', parameters: null }],
    changed: [{ identifier: 'ITEM-1', changes: [{ field: 'title', from: 'Intro', to: 'Introduction' }] }],
  },
  assets: {
    added: [{ path: 'new.css', sizeBytes: 2048, sha256: 'a' }],
    removed: [{ path: 'old.css', sizeBytes: 10, sha256: 'b' }],
    modified: [{ path: 'assets/app.js', fromSizeBytes: 100, toSizeBytes: 120 }],
    unchangedCount: 7,
    bytesDelta: 2058,
  },
  breakingChanges: ['SCO "ITEM-2" was removed'],
};

function HookProbe() {
  const list = useCourseVersions(versions, 'course_1');
  const idle = useCourseVersions(versions, null);
  const diff = useCourseVersionDiff(versions, 'course_1', { from: 1, to: 2 }, false);
  return (
    <span>{`${list.loading}:${list.pending}:${list.actionError === null}|${idle.loading}|${diff.loading}`}</span>
  );
}

describe('useCourseVersions / useCourseVersionDiff', () => {
  it('start loading when enabled and idle otherwise', () => {
    expect(renderToStaticMarkup(<HookProbe />)).toContain('true:null:true|false|false');
  });
});

describe('describeVersionDiff', () => {
  it('summarises every kind of change', () => {
    expect(describeVersionDiff(DIFF)).toBe(
      '1.0 → 2.0: 1 metadata change, 1 SCO added, 1 SCO removed, 1 SCO changed, 3 files changed',
    );
  });

  it('says so when nothing changed or files are unknown', () => {
    expect(describeVersionDiff({ ...DIFF, identical: true })).toBe('1.0 → 2.0: no changes');
    expect(
      describeVersionDiff({
        ...DIFF,
        metadata: [],
        scos: { added: [], removed: [], changed: [] },
        assets: null,
      }),
    ).toBe('1.0 → 2.0: file changes unknown');
  });
});

describe('formatters', () => {
  it('formats release dates in UTC and negative byte deltas', () => {
    expect(formatVersionDate('2026-10-22T23:30:00.000Z', 'en-US')).toBe('Oct 22, 2026');
    expect(formatVersionDate('not a date')).toBe('not a date');
    expect(formatBytes(-2048)).toBe('-2.0 KB');
  });
});

describe('<CourseVersionDiffView>', () => {
  it('renders breaking changes, metadata, SCOs and files', () => {
    const html = renderToStaticMarkup(<CourseVersionDiffView diff={DIFF} />);
    expect(html).toContain('Heads up');
    expect(html).toContain('SCO &quot;ITEM-2&quot; was removed');
    expect(html).toContain('masteryScore');
    expect(html).toContain('+ SCO Wrap-up');
    expect(html).toContain('− SCO Quiz');
    expect(html).toContain('title Intro → Introduction');
    expect(html).toContain('new.css');
    expect(html).toContain('2.0 KB');
    expect(html).toContain('100 B → 120 B');
    expect(html).toContain('7 unchanged');
  });

  it('truncates long file lists and explains a missing inventory', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.png`, sizeBytes: 1, sha256: String(i) }));
    const html = renderToStaticMarkup(
      <CourseVersionDiffView diff={{ ...DIFF, assets: { ...DIFF.assets!, added: many } }} maxFiles={2} />,
    );
    expect(html).toContain('+3 more');
    expect(renderToStaticMarkup(<CourseVersionDiffView diff={{ ...DIFF, assets: null }} />)).toContain(
      'predates versioning',
    );
  });
});

describe('<CourseVersionHistory>', () => {
  it('renders the loading state and publish form from the provider client', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <CourseVersionHistory courseId="course_1" />
      </ScormProvider>,
    );
    expect(html).toContain('data-scormflow-version-history="loading"');
    expect(html).toContain('Loading releases');
    expect(html).toContain('Publish a new release');
  });

  it('can hide the publish form', () => {
    const html = renderToStaticMarkup(
      <CourseVersionHistory courseId="course_1" client={versions} allowPublish={false} />,
    );
    expect(html).not.toContain('Publish a new release');
  });

  it('throws without a client or provider', () => {
    expect(() => renderToStaticMarkup(<CourseVersionHistory courseId="c" />)).toThrow(/needs a `client` prop/);
  });
});
