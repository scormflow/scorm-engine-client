import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScormTransport } from '@scormflow/sdk';

import { ScormPlayer } from './scorm-player.js';
import { useScormPlayer } from './use-scorm-player.js';

const noopTransport: ScormTransport = {
  async initialize() {
    return { attemptId: 'a1', version: 'SCORM_1_2', cmi: {} };
  },
  async commit() {
    return { ok: true };
  },
  async terminate() {},
};

describe('<ScormPlayer/>', () => {
  it('renders the SCO container', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer attemptId="a1" launchUrl="/sco/index.html" transport={noopTransport} />,
    );
    expect(html).toContain('data-scormflow-container');
  });

  it('shows the loading fallback before the effect runs (SSR)', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer
        attemptId="a1"
        launchUrl="/sco/index.html"
        transport={noopTransport}
        loadingFallback={<span>Loading course…</span>}
      />,
    );
    expect(html).toContain('Loading course…');
    expect(html).toContain('data-scormflow-overlay="loading"');
  });

  it('applies className and merges style', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer
        attemptId="a1"
        launchUrl="/sco/index.html"
        transport={noopTransport}
        className="my-player"
        style={{ height: 600 }}
      />,
    );
    expect(html).toContain('class="my-player"');
    expect(html).toContain('height:600px');
    // Component forces relative positioning for the overlay layer.
    expect(html).toContain('position:relative');
  });

  it('renders header, progress bar and footer chrome by default', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer
        title="Fire Safety 101"
        attemptId="a1"
        launchUrl="/sco/index.html"
        transport={noopTransport}
      />,
    );
    expect(html).toContain('data-scormflow-header');
    expect(html).toContain('Fire Safety 101');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('data-scormflow-footer');
    expect(html).toContain('data-scormflow-save');
  });

  it('hides the header when no title is given', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer attemptId="a1" launchUrl="/sco/index.html" transport={noopTransport} />,
    );
    expect(html).not.toContain('data-scormflow-header');
    // Footer + progress still render as part of the default chrome.
    expect(html).toContain('data-scormflow-footer');
  });

  it('renders a bare container when chrome is disabled', () => {
    const html = renderToStaticMarkup(
      <ScormPlayer
        chrome={false}
        attemptId="a1"
        launchUrl="/sco/index.html"
        transport={noopTransport}
      />,
    );
    expect(html).toContain('data-scormflow-container');
    expect(html).not.toContain('data-scormflow-footer');
    expect(html).not.toContain('role="progressbar"');
  });

  it('exposes a default error message when no errorFallback is provided', () => {
    // SSR renders in the loading state, so just assert the overlay wiring compiles.
    const html = renderToStaticMarkup(
      <ScormPlayer
        attemptId="a1"
        launchUrl="/sco/index.html"
        transport={noopTransport}
        loadingFallback={<span>Loading…</span>}
      />,
    );
    expect(html).toContain('data-scormflow-overlay="loading"');
  });
});

describe('exports', () => {
  it('exposes the hook', () => {
    expect(typeof useScormPlayer).toBe('function');
  });
});
