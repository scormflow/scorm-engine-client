import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceClient, ScormClient, type PackageValidationReport } from '@scormflow/sdk';

import {
  describeValidation,
  groupValidationIssues,
  PackageValidationView,
  PackageValidator,
} from './package-validation.js';
import { ScormProvider } from './scorm-context.js';
import { usePackageValidation } from './use-package-validation.js';

// SSR runs no effects or event handlers: the hook is asserted through its
// initial state and the rendering through the presentational view.
const neverFetch = async () => {
  throw new Error('not called during SSR');
};
const resources = new ResourceClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });

const REPORT: PackageValidationReport = {
  valid: false,
  version: 'SCORM_2004_4',
  errors: [
    {
      code: 'missing_launch_file',
      severity: 'error',
      category: 'resources',
      message: "Launch file 'start.html' for SCO resource 'R1' is not in the package",
      path: 'start.html',
    },
  ],
  warnings: [
    { code: 'a11y_missing_lang', severity: 'warning', category: 'accessibility', message: 'no lang', path: 'index.html' },
    { code: 'runtime_api_mismatch', severity: 'warning', category: 'runtime', message: 'wrong API', path: null },
  ],
  info: [{ code: 'junk_file', severity: 'info', category: 'structure', message: '.DS_Store', path: '.DS_Store' }],
  stats: { fileCount: 12, totalBytes: 2_500_000, launchableCount: 1, scannedFiles: 3 },
  manifest: { title: 'Fire Safety' },
};

const CLEAN: PackageValidationReport = {
  ...REPORT,
  valid: true,
  errors: [],
  warnings: [],
  info: [],
};

function HookProbe() {
  const { status, report, error } = usePackageValidation(resources);
  return <span>{`${status}:${report === null}:${error === null}`}</span>;
}

describe('usePackageValidation', () => {
  it('starts idle with no report', () => {
    expect(renderToStaticMarkup(<HookProbe />)).toContain('idle:true:true');
  });
});

describe('groupValidationIssues', () => {
  it('groups by category in a stable order, errors before warnings', () => {
    const groups = groupValidationIssues(REPORT);
    expect(groups.map((g) => g.category)).toEqual(['structure', 'resources', 'runtime', 'accessibility']);
  });

  it('can hide info issues', () => {
    expect(groupValidationIssues(REPORT, { hideInfo: true }).map((g) => g.category)).not.toContain('structure');
  });
});

describe('describeValidation', () => {
  it('summarises the verdict', () => {
    expect(describeValidation(REPORT)).toBe('Invalid — 1 error, 2 warnings');
    expect(describeValidation(CLEAN)).toBe('Valid — no problems found');
    expect(describeValidation({ ...CLEAN, warnings: REPORT.warnings.slice(0, 1) })).toBe('Valid — 1 warning');
  });
});

describe('<PackageValidationView/>', () => {
  it('renders the verdict, stats and grouped issues', () => {
    const html = renderToStaticMarkup(<PackageValidationView report={REPORT} />);
    expect(html).toContain('data-scormflow-validation="invalid"');
    expect(html).toContain('Fire Safety');
    expect(html).toContain('SCORM 2004 4');
    expect(html).toContain('12 files · 2.4 MB · 1 SCO');
    expect(html).toContain('Invalid — 1 error, 2 warnings');
    expect(html).toContain('Files and launch pages');
    expect(html).toContain('data-scormflow-issue="missing_launch_file"');
    expect(html).toContain('data-scormflow-issue="junk_file"');
  });

  it('honours hideInfo and a custom title', () => {
    const html = renderToStaticMarkup(<PackageValidationView report={REPORT} hideInfo title="Pre-flight" />);
    expect(html).toContain('Pre-flight');
    expect(html).not.toContain('junk_file');
  });

  it('renders a clean report', () => {
    const html = renderToStaticMarkup(<PackageValidationView report={CLEAN} />);
    expect(html).toContain('data-scormflow-validation="valid"');
    expect(html).toContain('no problems found');
    expect(html).not.toContain('data-scormflow-issue');
  });
});

describe('<PackageValidator/>', () => {
  it('renders a file picker from the provider client', () => {
    const client = new ScormClient({ baseUrl: 'https://engine.test/api/v1', fetch: neverFetch });
    const html = renderToStaticMarkup(
      <ScormProvider client={client}>
        <PackageValidator />
      </ScormProvider>,
    );
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".zip,application/zip"');
    expect(html).toContain('data-scormflow-validator="idle"');
  });

  it('throws without a client or provider', () => {
    expect(() => renderToStaticMarkup(<PackageValidator />)).toThrow(/needs a `client` prop/);
  });
});
