import { beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeState, ScormTransport } from '@scormflow/sdk';

import { createScorm2004Api, type Scorm2004Api } from './api-scorm2004.js';
import { RuntimeCore } from './runtime.js';

function fakeTransport(state: Partial<RuntimeState> = {}) {
  const calls = { commits: 0, terminates: 0 };
  const transport: ScormTransport = {
    async initialize() {
      return { attemptId: 'a1', version: 'SCORM_2004_4', cmi: state.cmi ?? {} };
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

describe('SCORM 2004 API', () => {
  let api: Scorm2004Api;
  let calls: { commits: number; terminates: number };

  beforeEach(async () => {
    const ft = fakeTransport({ cmi: { 'cmi.completion_status': 'incomplete' } });
    calls = ft.calls;
    const core = await RuntimeCore.create({ attemptId: 'a1', transport: ft.transport, autoCommitMs: 0 });
    api = createScorm2004Api(core);
  });

  it('uses 2004 lifecycle error codes', () => {
    expect(api.Initialize('')).toBe('true');
    expect(api.Initialize('')).toBe('false');
    expect(api.GetLastError()).toBe('103'); // already initialized
  });

  it('errors distinctly before init and after terminate', () => {
    expect(api.GetValue('cmi.completion_status')).toBe('');
    expect(api.GetLastError()).toBe('122'); // retrieve before initialization
    api.Initialize('');
    api.Terminate('');
    expect(api.GetValue('cmi.completion_status')).toBe('');
    expect(api.GetLastError()).toBe('123'); // retrieve after termination
  });

  it('reads cmi._version and rejects writing it', () => {
    api.Initialize('');
    expect(api.GetValue('cmi._version')).toBe('1.0');
    expect(api.SetValue('cmi._version', '2.0')).toBe('false');
    expect(api.GetLastError()).toBe('404'); // read only
  });

  it('round-trips writes and serves _count', () => {
    api.Initialize('');
    expect(api.SetValue('cmi.success_status', 'passed')).toBe('true');
    expect(api.GetValue('cmi.success_status')).toBe('passed');
    api.SetValue('cmi.objectives.0.id', 'o1');
    expect(api.GetValue('cmi.objectives._count')).toBe('1');
  });

  it('commits and terminates through the transport', async () => {
    api.Initialize('');
    api.SetValue('cmi.score.scaled', '0.9');
    expect(api.Commit('')).toBe('true');
    expect(api.Terminate('')).toBe('true');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.commits).toBeGreaterThanOrEqual(1);
    expect(calls.terminates).toBe(1);
  });

  it('rejects Terminate before Initialize', () => {
    expect(api.Terminate('')).toBe('false');
    expect(api.GetLastError()).toBe('112');
  });
});
