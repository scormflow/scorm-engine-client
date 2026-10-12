import { describe, expect, it, vi } from 'vitest';

import { CertificatesClient, type Certificate } from './certificates.js';
import { ScormClient } from './client.js';
import { ScormHttpError } from './errors.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://engine.test/api/v1';

const CERT: Certificate = {
  id: 'cert_1',
  serial: '7KQ2-M9XD-4TPA',
  status: 'valid',
  attemptId: 'att_1',
  courseId: 'course_1',
  learnerId: 'learner-1',
  learnerName: 'Ada Lovelace',
  courseTitle: 'Safety Basics',
  scorePercent: 90,
  completedAt: '2026-10-12T09:30:00.000Z',
  issuedAt: '2026-10-12T09:30:01.000Z',
  revokedAt: null,
  revokedReason: null,
  pdfUrl: '/api/v1/certificates/cert_1/pdf',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = new CertificatesClient({ baseUrl: BASE, apiKey: 'sk_test', fetch, retries: 0 });
  return { client, calls };
}

describe('CertificatesClient', () => {
  it('lists with filters and reads one', async () => {
    const { client, calls } = setup((url) =>
      url.includes('/certificates/cert_1')
        ? jsonResponse(CERT)
        : jsonResponse({ data: [CERT], pagination: { nextCursor: null, hasMore: false } }),
    );
    const page = await client.list({ learnerId: 'learner-1', status: 'valid', limit: 10 });
    expect(page.data).toEqual([CERT]);
    expect(calls[0]!.url).toBe(`${BASE}/certificates?learnerId=learner-1&status=valid&limit=10`);
    expect((calls[0]!.init.headers as Record<string, string>)['X-API-Key']).toBe('sk_test');

    expect(await client.get('cert_1')).toEqual(CERT);
  });

  it('downloads PDFs as Blobs with an application/pdf Accept', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake');
    const { client, calls } = setup(
      () => new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    const blob = await client.pdf('cert_1', { download: true });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdfBytes);
    expect(calls[0]!.url).toBe(`${BASE}/certificates/cert_1/pdf?download=1`);
    expect((calls[0]!.init.headers as Record<string, string>).accept).toBe('application/pdf');

    await client.attemptPdf('att_1');
    expect(calls[1]!.url).toBe(`${BASE}/attempts/att_1/certificate/pdf`);
  });

  it('builds token-carrying PDF links', () => {
    const { client } = setup(() => jsonResponse({}));
    expect(client.attemptPdfUrl('att 1')).toBe(`${BASE}/attempts/att%201/certificate/pdf`);
    expect(client.attemptPdfUrl('att_1', { token: 'jwt.x.y', download: true })).toBe(
      `${BASE}/attempts/att_1/certificate/pdf?token=jwt.x.y&download=1`,
    );
  });

  it('revokes with an optional reason', async () => {
    const { client, calls } = setup(() => jsonResponse({ ...CERT, status: 'revoked' }));
    await client.revoke('cert_1', 'Issued in error');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/certificates/cert_1/revoke`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ reason: 'Issued in error' });
    await client.revoke('cert_1');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({});
  });

  it('verifies a code, resolving null for an unknown one', async () => {
    const { client, calls } = setup((url) =>
      url.endsWith('/0000-0000-0000')
        ? jsonResponse({ code: 'certificate_not_found', message: 'No certificate has this code' }, 404)
        : jsonResponse({ valid: true, serial: CERT.serial, status: 'valid' }),
    );
    expect(await client.verify(' 7KQ2-M9XD-4TPA ')).toMatchObject({ valid: true });
    expect(calls[0]!.url).toBe(`${BASE}/certificates/verify/7KQ2-M9XD-4TPA`);
    expect(await client.verify('0000-0000-0000')).toBeNull();
  });

  it("reads an attempt's certificate, resolving null before it is issued", async () => {
    let issued = false;
    const { client } = setup(() =>
      issued ? jsonResponse(CERT) : jsonResponse({ code: 'certificate_not_found', message: 'Certificate not found' }, 404),
    );
    expect(await client.forAttempt('att_1')).toBeNull();
    issued = true;
    expect(await client.forAttempt('att_1')).toEqual(CERT);
  });

  it('still throws other errors from forAttempt', async () => {
    const { client } = setup(() => jsonResponse({ code: 'attempt_not_found', message: 'nope' }, 404));
    await expect(client.forAttempt('att_1')).rejects.toBeInstanceOf(ScormHttpError);
  });

  it('issues on demand and reports whether it was new', async () => {
    let status = 201;
    const { client, calls } = setup(() => jsonResponse(CERT, status));
    expect(await client.issue('att_1')).toEqual({ certificate: CERT, created: true });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${BASE}/attempts/att_1/certificate`);
    status = 200;
    expect((await client.issue('att_1')).created).toBe(false);

    status = 409;
    const notEligible = setup(() =>
      jsonResponse({ code: 'attempt_not_eligible', message: 'A certificate needs a completed attempt' }, 409),
    );
    await expect(notEligible.client.issue('att_1')).rejects.toMatchObject({ status: 409, code: 'attempt_not_eligible' });
  });

  it('is exposed on the ScormClient facade, sharing its HttpClient', () => {
    const client = new ScormClient({ baseUrl: BASE, apiKey: 'sk_test' });
    expect(client.certificates).toBeInstanceOf(CertificatesClient);
    expect(client.certificates.http).toBe(client.http);
  });
});
