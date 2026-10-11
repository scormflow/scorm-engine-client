import { useCallback, useRef, useState } from 'react';
import type { Course, ResourceClient } from '@scormflow/sdk';

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface UseScormUploadResult {
  /** Upload a package; resolves with the created course, or null on failure. */
  upload: (file: Blob, options?: { title?: string }) => Promise<Course | null>;
  status: UploadStatus;
  /** Upload progress in [0, 1]; may stay 0 on transports without progress events. */
  progress: number;
  result: Course | null;
  error: unknown;
  reset: () => void;
}

/**
 * Upload a SCORM package with progress. Reports progress via the SDK's XHR
 * upload path in the browser; the returned `upload` also resolves with the
 * created course (or null on error, with `error` populated).
 */
export function useScormUpload(resources: ResourceClient): UseScormUploadResult {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Course | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
  }, []);

  const upload = useCallback(
    async (file: Blob, options?: { title?: string }): Promise<Course | null> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('uploading');
      setProgress(0);
      setError(null);
      setResult(null);
      try {
        const course = await resources.uploadCourse(file, {
          ...(options?.title ? { title: options.title } : {}),
          onProgress: setProgress,
          signal: controller.signal,
        });
        setResult(course);
        setStatus('success');
        setProgress(1);
        return course;
      } catch (err) {
        setError(err);
        setStatus('error');
        return null;
      } finally {
        abortRef.current = null;
      }
    },
    [resources],
  );

  return { upload, status, progress, result, error, reset };
}
