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
});

describe('exports', () => {
  it('exposes the hook', () => {
    expect(typeof useScormPlayer).toBe('function');
  });
});
