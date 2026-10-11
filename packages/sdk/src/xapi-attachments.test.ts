import { describe, expect, it, vi } from 'vitest';

import { XapiClient } from './xapi.js';
import {
  decodeMultipart,
  decodeStatementResponse,
  encodeMultipart,
  encodeStatementUpload,
  prepareXapiAttachment,
  sha256Hex,
} from './xapi-attachments.js';
import type { FetchLike } from './http/http-client.js';

const BASE = 'https://x/v1';
const STATEMENT = {
  actor: { mbox: 'mailto:ada@example.com' },
  verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
  object: { id: 'http://example.com/courses/intro' },
};
// SHA-256 of the ASCII string "abc", from FIPS 180-2.
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function client(fetchMock: FetchLike): XapiClient {
  return new XapiClient({ baseUrl: BASE, apiKey: 'k', fetch: fetchMock, retries: 0 });
}

describe('prepareXapiAttachment', () => {
  it('hashes the body and fills in length', async () => {
    const { attachment, body } = await prepareXapiAttachment({
      usageType: 'http://id.tincanapi.com/attachment/certificate-of-completion',
      display: { 'en-US': 'Certificate' },
      contentType: 'text/plain',
      content: 'abc',
    });

    expect(attachment).toEqual({
      usageType: 'http://id.tincanapi.com/attachment/certificate-of-completion',
      display: { 'en-US': 'Certificate' },
      contentType: 'text/plain',
      length: 3,
      sha2: ABC_SHA256,
    });
    expect(body.sha2).toBe(ABC_SHA256);
    expect(new TextDecoder().decode(body.content)).toBe('abc');
  });

  it('accepts Blob and ArrayBuffer content', async () => {
    const fromBlob = await prepareXapiAttachment({
      usageType: 'u',
      display: {},
      contentType: 'text/plain',
      content: new Blob(['abc']),
    });
    const fromBuffer = await prepareXapiAttachment({
      usageType: 'u',
      display: {},
      contentType: 'text/plain',
      content: new TextEncoder().encode('abc').buffer as ArrayBuffer,
    });
    expect(fromBlob.attachment.sha2).toBe(ABC_SHA256);
    expect(fromBuffer.attachment.sha2).toBe(ABC_SHA256);
  });
});

describe('multipart codec', () => {
  it('round-trips binary bodies, including CRLF and dashes', async () => {
    const binary = new Uint8Array([0, 13, 10, 45, 45, 255, 13, 10]);
    const encoded = encodeMultipart([
      { headers: { 'Content-Type': 'application/json' }, body: new TextEncoder().encode('[]') },
      { headers: { 'X-Experience-API-Hash': await sha256Hex(binary) }, body: binary },
    ]);
    const parts = decodeMultipart(encoded.body, encoded.contentType);

    expect(parts).toHaveLength(2);
    expect(parts[0]!.headers['content-type']).toBe('application/json');
    expect(Array.from(parts[1]!.body)).toEqual(Array.from(binary));
  });

  it('rejects a body with no closing boundary', () => {
    const body = new TextEncoder().encode('--b\r\nContent-Type: application/json\r\n\r\n[]');
    expect(() => decodeMultipart(body, 'multipart/mixed; boundary=b')).toThrow(/closing boundary/);
  });

  it('decodes a statement response into JSON and attachment bodies', () => {
    const encoded = encodeStatementUpload({ statements: [], more: '' }, [
      { sha2: ABC_SHA256, contentType: 'text/plain', content: new TextEncoder().encode('abc') },
    ]);
    const decoded = decodeStatementResponse(encoded.body, encoded.contentType);

    expect(decoded.json).toEqual({ statements: [], more: '' });
    expect(decoded.attachments).toEqual([
      { sha2: ABC_SHA256, contentType: 'text/plain', content: new TextEncoder().encode('abc') },
    ]);
  });
});

describe('XapiClient attachments', () => {
  it('sends JSON when there are no attachment bodies', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => Response.json(['id-1']));
    await client(fetchMock).storeStatements(STATEMENT, { attachments: [] });

    const init = fetchMock.mock.calls[0]![1];
    expect(typeof init.body).toBe('string');
  });

  it('sends multipart/mixed with the attachment parts', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => Response.json(['id-1']));
    const xapi = client(fetchMock);
    const cert = await xapi.prepareAttachment({
      usageType: 'http://id.tincanapi.com/attachment/certificate-of-completion',
      display: { 'en-US': 'Certificate' },
      contentType: 'text/plain',
      content: 'abc',
    });

    const ids = await xapi.storeStatements(
      { ...STATEMENT, attachments: [cert.attachment] },
      { attachments: [cert.body] },
    );

    expect(ids).toEqual(['id-1']);
    const init = fetchMock.mock.calls[0]![1];
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toMatch(/^multipart\/mixed; boundary=/);
    expect(headers['X-Experience-API-Version']).toBe('1.0.3');

    const parts = decodeMultipart(init.body as Uint8Array, headers['content-type']!);
    expect(parts).toHaveLength(2);
    expect(JSON.parse(new TextDecoder().decode(parts[0]!.body)).attachments[0].sha2).toBe(ABC_SHA256);
    expect(parts[1]!.headers).toEqual({
      'content-type': 'text/plain',
      'content-transfer-encoding': 'binary',
      'x-experience-api-hash': ABC_SHA256,
    });
  });

  it('puts a statement with attachments', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    const xapi = client(fetchMock);
    const cert = await xapi.prepareAttachment({
      usageType: 'u',
      display: {},
      contentType: 'text/plain',
      content: 'abc',
    });
    await xapi.putStatement('abc', { ...STATEMENT, attachments: [cert.attachment] }, {
      attachments: [cert.body],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url).searchParams.get('statementId')).toBe('abc');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toMatch(/^multipart\/mixed/);
  });

  it('downloads a statement with its attachments', async () => {
    const statement = { ...STATEMENT, id: 's1' };
    const fetchMock = vi.fn<FetchLike>(async () => {
      const encoded = encodeStatementUpload(statement, [
        { sha2: ABC_SHA256, contentType: 'text/plain', content: new TextEncoder().encode('abc') },
      ]);
      return new Response(encoded.body as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': encoded.contentType },
      });
    });

    const result = await client(fetchMock).getStatementWithAttachments('s1');

    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('attachments')).toBe('true');
    expect(result?.statement).toEqual(statement);
    expect(new TextDecoder().decode(result!.attachments[0]!.content)).toBe('abc');
  });

  it('returns null for an unknown statement', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      Response.json({ code: 'statement_not_found', message: 'nope' }, { status: 404 }),
    );
    expect(await client(fetchMock).getStatementWithAttachments('missing')).toBeNull();
  });

  it('queries statements with attachments, keeping the filters', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      const encoded = encodeStatementUpload({ statements: [STATEMENT], more: '' }, []);
      return new Response(encoded.body as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': encoded.contentType },
      });
    });

    const page = await client(fetchMock).queryStatementsWithAttachments({ verb: 'v', limit: 5 });

    const query = new URL(fetchMock.mock.calls[0]![0]).searchParams;
    expect(query.get('verb')).toBe('v');
    expect(query.get('limit')).toBe('5');
    expect(query.get('attachments')).toBe('true');
    expect(page).toEqual({ statements: [STATEMENT], more: '', attachments: [] });
  });
});
