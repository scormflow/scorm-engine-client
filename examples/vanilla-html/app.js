// @ts-check
import { RestTransport } from '@scormflow/sdk';
import { mountScormPlayer } from '@scormflow/player';

/** @param {string} id */
const el = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

const val = (id) => /** @type {HTMLInputElement} */ (el(id)).value.trim();

/** @type {import('@scormflow/player').ScormPlayerHandle | null} */
let player = null;

function showError(message) {
  const node = el('error');
  node.textContent = message ? `Error: ${message}` : '';
  node.hidden = !message;
}

el('start').addEventListener('click', async () => {
  showError('');
  const courseId = val('courseId');
  const learnerId = val('learnerId');
  const launchUrl = val('launchUrl');
  if (!courseId || !learnerId) {
    showError('Course ID and Learner ID are required.');
    return;
  }
  if (!launchUrl) {
    showError('A SCO launch URL is required to embed the content.');
    return;
  }

  const button = /** @type {HTMLButtonElement} */ (el('start'));
  button.disabled = true;
  el('status').textContent = 'Starting…';

  const transport = new RestTransport({
    baseUrl: val('baseUrl'),
    ...(val('apiKey') ? { apiKey: val('apiKey') } : {}),
  });

  try {
    const attempt = await transport.startAttempt(courseId, {
      learnerId,
      ...(val('learnerName') ? { learnerName: val('learnerName') } : {}),
    });

    el('attemptMeta').textContent =
      `attempt ${attempt.attemptId} · ${attempt.version} · ` +
      `${attempt.resumed ? 'resumed' : 'new'} · entry ${attempt.entry ?? '—'}`;

    player = await mountScormPlayer({
      container: '#scorm-root',
      attemptId: attempt.attemptId,
      launchUrl,
      transport,
      onCommit: (result) => {
        const s = result.summary;
        el('lastCommit').textContent = s
          ? `last commit: completion=${s.completionStatus} success=${s.successStatus} score=${s.scoreScaled ?? '—'}`
          : 'last commit: committed';
      },
      onError: (err) => showError(err instanceof Error ? err.message : String(err)),
    });

    el('config').hidden = true;
    el('playerPanel').hidden = false;
    el('status').textContent = '';
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    button.disabled = false;
    if (el('status').textContent === 'Starting…') el('status').textContent = '';
  }
});

el('stop').addEventListener('click', async () => {
  if (player) {
    await player.destroy();
    player = null;
  }
  el('playerPanel').hidden = true;
  el('config').hidden = false;
  el('lastCommit').textContent = 'last commit: —';
});
