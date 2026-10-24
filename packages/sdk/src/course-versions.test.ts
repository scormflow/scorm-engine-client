import { describe, expect, it, vi } from 'vitest';

import { ScormClient } from './client.js';
import { CourseVersionsClient, type CourseVersion } from './course-versions.js';
import { ScormHttpError } from './errors.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://engine.test/api/v1';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const VERSION: CourseVersion = {
  id: 'cv_2',
  courseId: 'course 1',
  number: 2,
  label: '1.1',
  releaseNotes: 'New quiz',
  current: true,
  title: 'Safety',
  description: null,
  scormVersion: 'SCORM_1_2',
  masteryScore: 75,
  launchHref: 'index.html',
  scoCount: 1,
  fileCount: 4,
  sizeBytes: 1234,
  packageSha256: 'ab'.repeat(32),
  createdAt: '2026-10-22T09:00:00.000Z',
};

function setup(respond: (url: string, init: RequestInit) => Response = () => jsonResponse(VERSION)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = new CourseVersionsClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries: 0 });
  return { client, calls, fetch };
}

describe('CourseVersionsClient', () => {
  it('lists releases', async () => {
    const { client, calls } = setup(() => jsonResponse({ data: [VERSION], currentVersion: 2 }));
    const res = await client.list('course 1');
    expect(calls[0]!.url).toBe(`${BASE}/courses/course%201/versions`);
    expect(res.currentVersion).toBe(2);
    expect(res.data[0]!.label).toBe('1.1');
  });

  it('gets one release by number', async () => {
    const { client, calls } = setup();
    await client.get('course 1', 2);
    expect(calls[0]!.url).toBe(`${BASE}/courses/course%201/versions/2`);
  });

  it('publishes as multipart with fields before the file, never retrying', async () => {
    const { calls } = setup();
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"code":"unavailable","message":"x"}', { status: 503 });
    });
    // Retries on at the client level: publish must still send exactly once.
    const retrying = new CourseVersionsClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries: 3 });
    await expect(
      retrying.publish('course 1', new Blob(['zip']), { releaseNotes: 'n', bump: 'major', activate: false }),
    ).rejects.toBeInstanceOf(ScormHttpError);
    expect(fetch).toHaveBeenCalledTimes(1);

    const { client, calls: ok } = setup();
    const res = await client.publish('course 1', new Blob(['zip']), {
      label: '2.0',
      releaseNotes: 'Big rewrite',
      title: 'Safety 2',
      activate: false,
    });
    expect(res.number).toBe(2);
    expect(ok[0]!.url).toBe(`${BASE}/courses/course%201/versions`);
    expect(ok[0]!.init.method).toBe('POST');
    const form = ok[0]!.init.body as FormData;
    expect([...form.keys()]).toEqual(['label', 'releaseNotes', 'title', 'activate', 'file']);
    expect(form.get('activate')).toBe('false');
    expect(form.get('label')).toBe('2.0');
  });

  it('updates release notes with PATCH', async () => {
    const { client, calls } = setup();
    await client.updateNotes('course 1', 2, null);
    expect(calls[0]!.url).toBe(`${BASE}/courses/course%201/versions/2`);
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ releaseNotes: null });
  });

  it('diffs with optional from/to', async () => {
    const { client, calls } = setup(() => jsonResponse({ identical: true }));
    await client.diff('c1');
    expect(calls[0]!.url).toBe(`${BASE}/courses/c1/versions/diff`);
    await client.diff('c1', { from: 1, to: 3 });
    expect(calls[1]!.url).toBe(`${BASE}/courses/c1/versions/diff?from=1&to=3`);
  });

  it('rolls back by release number', async () => {
    const { client, calls } = setup();
    await client.rollback('c1', 1);
    expect(calls[0]!.url).toBe(`${BASE}/courses/c1/rollback`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ version: 1 });
  });

  it('surfaces engine errors such as a taken label', async () => {
    const { client } = setup(() =>
      jsonResponse({ code: 'version_label_taken', message: 'Version label "1.0" is already used' }, 409),
    );
    const err = await client.publish('c1', new Blob(['zip']), { label: '1.0' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScormHttpError);
    expect((err as ScormHttpError).status).toBe(409);
    expect((err as ScormHttpError).code).toBe('version_label_taken');
  });

  it('is exposed as client.courses.versions sharing the client http config', () => {
    const client = new ScormClient({ baseUrl: BASE, apiKey: 'sk_test' });
    expect(client.courses.versions).toBeInstanceOf(CourseVersionsClient);
    expect(client.courses.versions.http).toBe(client.http);
  });
});
