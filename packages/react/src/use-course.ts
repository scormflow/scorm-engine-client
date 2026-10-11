import type { Course, CourseAnalytics, ResourceClient } from '@scormflow/sdk';

import { useAsyncResource, type AsyncResource } from './use-resource.js';

/**
 * Fetch a single course by id. Pass a falsy `courseId` to stay idle (e.g. before
 * a selection is made).
 */
export function useCourse(
  resources: ResourceClient,
  courseId: string | null | undefined,
): AsyncResource<Course> {
  return useAsyncResource<Course>(
    `course:${courseId ?? ''}`,
    (signal) => resources.getCourse(courseId as string, { signal }),
    Boolean(courseId),
  );
}

/** Fetch analytics for a single course. Idle while `courseId` is falsy. */
export function useCourseAnalytics(
  resources: ResourceClient,
  courseId: string | null | undefined,
): AsyncResource<CourseAnalytics> {
  return useAsyncResource<CourseAnalytics>(
    `course-analytics:${courseId ?? ''}`,
    (signal) => resources.getCourseAnalytics(courseId as string, { signal }),
    Boolean(courseId),
  );
}
