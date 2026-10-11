import { Scorm2004Error, errorString } from './errors.js';
import type { RuntimeCore } from './runtime.js';

/**
 * The `window.API_1484_11` object a SCORM 2004 SCO discovers and calls. Mirrors
 * {@link import('./api-scorm12.js').Scorm12Api} with 2004 verbs and the richer
 * 2004 error-code set; state is served synchronously from the
 * {@link RuntimeCore} store.
 */
export interface Scorm2004Api {
  Initialize(param: string): string;
  Terminate(param: string): string;
  GetValue(element: string): string;
  SetValue(element: string, value: string): string;
  Commit(param: string): string;
  GetLastError(): string;
  GetErrorString(code: string): string;
  GetDiagnostic(code: string): string;
}

type Phase = 'not_initialized' | 'running' | 'terminated';

export function createScorm2004Api(core: RuntimeCore): Scorm2004Api {
  let phase: Phase = 'not_initialized';
  let lastError: string = Scorm2004Error.NoError;

  const fail = (code: string): string => {
    lastError = code;
    return 'false';
  };
  const ok = (value = 'true'): string => {
    lastError = Scorm2004Error.NoError;
    return value;
  };

  return {
    Initialize(param): string {
      if (param !== '') return fail(Scorm2004Error.GeneralArgumentError);
      if (phase === 'running') return fail(Scorm2004Error.AlreadyInitialized);
      if (phase === 'terminated') return fail(Scorm2004Error.ContentInstanceTerminated);
      phase = 'running';
      return ok();
    },

    Terminate(param): string {
      if (param !== '') return fail(Scorm2004Error.GeneralArgumentError);
      if (phase === 'not_initialized') return fail(Scorm2004Error.TerminationBeforeInitialization);
      if (phase === 'terminated') return fail(Scorm2004Error.TerminationAfterTermination);
      phase = 'terminated';
      void core.terminate().catch((err) => core.reportError(err));
      return ok();
    },

    GetValue(element): string {
      if (phase === 'not_initialized') {
        lastError = Scorm2004Error.RetrieveDataBeforeInitialization;
        return '';
      }
      if (phase === 'terminated') {
        lastError = Scorm2004Error.RetrieveDataAfterTermination;
        return '';
      }
      if (element === 'cmi._version') return ok('1.0');
      if (element.endsWith('._count')) {
        return ok(String(core.store.count(element.slice(0, -'._count'.length))));
      }
      const value = core.store.get(element);
      return ok(value ?? '');
    },

    SetValue(element, value): string {
      if (phase === 'not_initialized') return fail(Scorm2004Error.StoreDataBeforeInitialization);
      if (phase === 'terminated') return fail(Scorm2004Error.StoreDataAfterTermination);
      if (element.endsWith('._count') || element.endsWith('._children') || element === 'cmi._version') {
        return fail(Scorm2004Error.DataModelElementReadOnly);
      }
      core.store.set(element, String(value));
      core.scheduleAutoCommit();
      return ok();
    },

    Commit(param): string {
      if (param !== '') return fail(Scorm2004Error.GeneralArgumentError);
      if (phase === 'not_initialized') return fail(Scorm2004Error.CommitBeforeInitialization);
      if (phase === 'terminated') return fail(Scorm2004Error.CommitAfterTermination);
      void core.commit().catch((err) => core.reportError(err));
      return ok();
    },

    GetLastError(): string {
      return lastError;
    },

    GetErrorString(code): string {
      return errorString('2004', code || lastError);
    },

    GetDiagnostic(code): string {
      return errorString('2004', code || lastError);
    },
  };
}
