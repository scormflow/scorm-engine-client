import { beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeState, ScormTransport } from '@scormflow/sdk';

import { createScorm12Api, type Scorm12Api } from './api-scorm12.js';
import { RuntimeCore } from './runtime.js';

function fakeTransport(state: Partial<RuntimeState> = {}) {
  const calls = { commits: 0, terminates: 0 };
  const transport: ScormTransport = {
    async initialize() {
      return { attemptId: 'a1', version: 'SCORM_1_2', cmi: state.cmi ?? {} };
    },
    async commit() {
      calls.commits++;
      return { ok: true };
    },
    async terminate() {
      calls.terminates++;
    },
  };
  return { transport, calls };
}

describe('SCORM 1.2 API', () => {
  let api: Scorm12Api;
  let calls: { commits: number; terminates: number };

  beforeEach(async () => {
    const ft = fakeTransport({ cmi: { 'cmi.core.lesson_status': 'incomplete' } });
    calls = ft.calls;
    const core = await RuntimeCore.create({ attemptId: 'a1', transport: ft.transport, autoCommitMs: 0 });
    api = createScorm12Api(core);
  });

  it('initializes once and rejects a second initialize', () => {
    expect(api.LMSInitialize('')).toBe('true');
    expect(api.LMSGetLastError()).toBe('0');
    expect(api.LMSInitialize('')).toBe('false');
    expect(api.LMSGetLastError()).toBe('101');
  });

  it('rejects a non-empty initialize argument', () => {
    expect(api.LMSInitialize('x')).toBe('false');
    expect(api.LMSGetLastError()).toBe('201');
  });

  it('errors on GetValue before initialize', () => {
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('');
    expect(api.LMSGetLastError()).toBe('301');
  });

  it('reads hydrated values and round-trips writes', () => {
    api.LMSInitialize('');
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('incomplete');
    expect(api.LMSSetValue('cmi.core.lesson_status', 'completed')).toBe('true');
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('completed');
    expect(api.LMSGetLastError()).toBe('0');
  });

  it('serves _count from the store', () => {
    api.LMSInitialize('');
    api.LMSSetValue('cmi.objectives.0.id', 'obj-a');
    api.LMSSetValue('cmi.objectives.1.id', 'obj-b');
    expect(api.LMSGetValue('cmi.objectives._count')).toBe('2');
  });

  it('rejects writing to a keyword element', () => {
    api.LMSInitialize('');
    expect(api.LMSSetValue('cmi.objectives._count', '5')).toBe('false');
    expect(api.LMSGetLastError()).toBe('402');
  });

  it('commits and finishes, driving the transport', async () => {
    api.LMSInitialize('');
    api.LMSSetValue('cmi.core.score.raw', '80');
    expect(api.LMSCommit('')).toBe('true');
    expect(api.LMSFinish('')).toBe('true');
    // Fire-and-forget async work settles on the next microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.commits).toBeGreaterThanOrEqual(1);
    expect(calls.terminates).toBe(1);
  });

  it('blocks access after finish', () => {
    api.LMSInitialize('');
    api.LMSFinish('');
    expect(api.LMSSetValue('cmi.location', 'x')).toBe('false');
    expect(api.LMSGetLastError()).toBe('301');
  });

  it('maps error codes to strings', () => {
    expect(api.LMSGetErrorString('301')).toBe('Not initialized');
    expect(api.LMSGetErrorString('403')).toBe('Element is read only');
  });
});
