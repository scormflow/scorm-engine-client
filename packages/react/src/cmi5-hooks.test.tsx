import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Cmi5Client } from '@scormflow/sdk';

import { useCmi5Course, useCmi5Launch, useCmi5LearnerPreferences, useCmi5Registration } from './use-cmi5.js';

// SSR does not run effects, so these assert the hooks' initial (pre-fetch) state
// and that they render without throwing. The fake client is never called.
const fakeCmi5 = {} as Cmi5Client;

function state({ loading, data }: { loading: boolean; data: unknown }): string {
  return loading ? 'loading' : data ? 'loaded' : 'idle';
}

function CourseView({ courseId }: { courseId: string | null }) {
  return <span>{state(useCmi5Course(fakeCmi5, courseId))}</span>;
}

function RegistrationView({ registrationId }: { registrationId: string | null }) {
  return <span>{state(useCmi5Registration(fakeCmi5, registrationId))}</span>;
}

function PreferencesView({ learnerId }: { learnerId: string | null }) {
  return <span>{state(useCmi5LearnerPreferences(fakeCmi5, learnerId ? { learnerId } : null))}</span>;
}

function LaunchView() {
  const { status, result } = useCmi5Launch(fakeCmi5);
  return (
    <span>
      {status}:{result ? 'url' : 'none'}
    </span>
  );
}

describe('useCmi5Course', () => {
  it('loads when given an id and idles without one', () => {
    expect(renderToStaticMarkup(<CourseView courseId="c1" />)).toContain('loading');
    expect(renderToStaticMarkup(<CourseView courseId={null} />)).toContain('idle');
  });
});

describe('useCmi5Registration', () => {
  it('loads when given an id and idles without one', () => {
    expect(renderToStaticMarkup(<RegistrationView registrationId="r1" />)).toContain('loading');
    expect(renderToStaticMarkup(<RegistrationView registrationId={null} />)).toContain('idle');
  });
});

describe('useCmi5Launch', () => {
  it('starts idle with no result', () => {
    expect(renderToStaticMarkup(<LaunchView />)).toContain('idle:none');
  });
});

describe('useCmi5LearnerPreferences', () => {
  it('loads when given a learner and idles without one', () => {
    expect(renderToStaticMarkup(<PreferencesView learnerId="u1" />)).toContain('loading');
    expect(renderToStaticMarkup(<PreferencesView learnerId={null} />)).toContain('idle');
  });
});
