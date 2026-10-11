import { Scorm12Error, errorString } from './errors.js';
import type { RuntimeCore } from './runtime.js';

/**
 * The `window.API` object a SCORM 1.2 SCO discovers and calls. Every method
 * returns a string per the spec; state is served synchronously from the
 * {@link RuntimeCore} store, with commits flushed to the engine in the
 * background.
 */
export interface Scorm12Api {
  LMSInitialize(param: string): string;
  LMSFinish(param: string): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(param: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

type Phase = 'not_initialized' | 'running' | 'terminated';

export function createScorm12Api(core: RuntimeCore): Scorm12Api {
  let phase: Phase = 'not_initialized';
  let lastError: string = Scorm12Error.NoError;

  const fail = (code: string): string => {
    lastError = code;
    return 'false';
  };
  const ok = (value = 'true'): string => {
    lastError = Scorm12Error.NoError;
    return value;
  };

  return {
    LMSInitialize(param): string {
      if (param !== '') return fail(Scorm12Error.InvalidArgument);
      if (phase === 'running' || phase === 'terminated') {
        return fail(Scorm12Error.GeneralException);
      }
      phase = 'running';
      return ok();
    },

    LMSFinish(param): string {
      if (param !== '') return fail(Scorm12Error.InvalidArgument);
      if (phase !== 'running') return fail(Scorm12Error.NotInitialized);
      phase = 'terminated';
      // Fire-and-forget: the SCO's page may be unloading; surface async failures.
      void core.terminate().catch((err) => core.reportError(err));
      return ok();
    },

    LMSGetValue(element): string {
      if (phase !== 'running') {
        lastError = Scorm12Error.NotInitialized;
        return '';
      }
      if (element.endsWith('._count')) {
        return ok(String(core.store.count(element.slice(0, -'._count'.length))));
      }
      const value = core.store.get(element);
      return ok(value ?? '');
    },

    LMSSetValue(element, value): string {
      if (phase !== 'running') return fail(Scorm12Error.NotInitialized);
      if (element.endsWith('._count') || element.endsWith('._children')) {
        return fail(Scorm12Error.ElementIsKeyword);
      }
      core.store.set(element, String(value));
      core.scheduleAutoCommit();
      return ok();
    },

    LMSCommit(param): string {
      if (param !== '') return fail(Scorm12Error.InvalidArgument);
      if (phase !== 'running') return fail(Scorm12Error.NotInitialized);
      void core.commit().catch((err) => core.reportError(err));
      return ok();
    },

    LMSGetLastError(): string {
      return lastError;
    },

    LMSGetErrorString(code): string {
      return errorString('SCORM_1_2', code || lastError);
    },

    LMSGetDiagnostic(code): string {
      return errorString('SCORM_1_2', code || lastError);
    },
  };
}
