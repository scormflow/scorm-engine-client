import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResourceClient } from '@scormflow/sdk';

import { useCourse } from './use-course.js';
import { useScormUpload } from './use-scorm-upload.js';

// SSR does not run effects, so these assert the hooks' initial (pre-fetch) state
// and that they render without throwing. A fake client is never actually called.
const fakeResources = {} as ResourceClient;

function CourseView({ courseId }: { courseId: string | null }) {
  const { loading, data } = useCourse(fakeResources, courseId);
  return <span>{loading ? 'loading' : data ? 'loaded' : 'idle'}</span>;
}

function UploadView() {
  const { status, progress } = useScormUpload(fakeResources);
  return (
    <span>
      {status}:{progress}
    </span>
  );
}

describe('useCourse', () => {
  it('starts in loading state when a courseId is provided', () => {
    expect(renderToStaticMarkup(<CourseView courseId="c1" />)).toContain('loading');
  });

  it('stays idle when courseId is null', () => {
    expect(renderToStaticMarkup(<CourseView courseId={null} />)).toContain('idle');
  });
});

describe('useScormUpload', () => {
  it('starts idle with zero progress', () => {
    expect(renderToStaticMarkup(<UploadView />)).toContain('idle:0');
  });
});
