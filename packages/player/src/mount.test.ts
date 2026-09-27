import { describe, expect, it } from 'vitest';
import type { RuntimeState, ScormTransport } from '@scormflow/sdk';

import { attachScormApi, type ScormWindow } from './mount.js';
import { RuntimeCore } from './runtime.js';

function transportFor(version: RuntimeState['version']): ScormTransport {
  return {
    async initialize() {
      return { attemptId: 'a1', version, cmi: {} };
    },
    async commit() {
      return { ok: true };
    },
    async terminate() {},
  };
}

describe('attachScormApi', () => {
  it('exposes window.API for SCORM 1.2 and detaches cleanly', async () => {
    const core = await RuntimeCore.create({
      attemptId: 'a1',
      transport: transportFor('SCORM_1_2'),
      autoCommitMs: 0,
    });
    const win: ScormWindow = {};
    const detach = attachScormApi(win, core);
    expect(typeof win.API?.LMSInitialize).toBe('function');
    expect(win.API_1484_11).toBeUndefined();
    detach();
    expect(win.API).toBeUndefined();
  });

  it('exposes window.API_1484_11 for SCORM 2004', async () => {
    const core = await RuntimeCore.create({
      attemptId: 'a1',
      transport: transportFor('SCORM_2004_4'),
      autoCommitMs: 0,
    });
    const win: ScormWindow = {};
    const detach = attachScormApi(win, core);
    expect(typeof win.API_1484_11?.Initialize).toBe('function');
    expect(win.API).toBeUndefined();
    detach();
    expect(win.API_1484_11).toBeUndefined();
  });
});
