import { useCallback, useRef, useState } from 'react';
import type { PackageValidationReport, ResourceClient } from '@scormflow/sdk';

export type ValidationStatus = 'idle' | 'validating' | 'done' | 'error';

export interface UsePackageValidationResult {
  /** Validate a package; resolves with the report, or null when the request failed. */
  validate: (file: Blob) => Promise<PackageValidationReport | null>;
  status: ValidationStatus;
  report: PackageValidationReport | null;
  /** Request failure (network, auth, …). An invalid package is a `report`, not an error. */
  error: unknown;
  reset: () => void;
}

/**
 * Validate a SCORM package against the engine without uploading it as a course.
 * A newer `validate` call aborts the previous one; only the latest result lands.
 */
export function usePackageValidation(resources: ResourceClient): UsePackageValidationResult {
  const [status, setStatus] = useState<ValidationStatus>('idle');
  const [report, setReport] = useState<PackageValidationReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setReport(null);
    setError(null);
  }, []);

  const validate = useCallback(
    async (file: Blob): Promise<PackageValidationReport | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('validating');
      setReport(null);
      setError(null);
      try {
        const result = await resources.validateCourse(file, { signal: controller.signal });
        if (abortRef.current !== controller) return result;
        setReport(result);
        setStatus('done');
        return result;
      } catch (err) {
        if (abortRef.current !== controller) return null;
        setError(err);
        setStatus('error');
        return null;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [resources],
  );

  return { validate, status, report, error, reset };
}
