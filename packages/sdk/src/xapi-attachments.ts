/**
 * xAPI attachment helpers: hashing attachment bodies and the `multipart/mixed`
 * encoding the LRS uses to carry them next to statements.
 *
 * Dependency-free and isomorphic — hashing uses Web Crypto (`crypto.subtle`),
 * available in browsers and Node 20+.
 */

/** Statement-level metadata for one attachment, as xAPI defines it. */
export interface XapiAttachment {
  usageType: string;
  display: Record<string, string>;
  description?: Record<string, string>;
  contentType: string;
  length: number;
  /** Hex SHA-2 digest of the body. */
  sha2: string;
  fileUrl?: string;
}

/** An attachment body, sent with a statement or returned with `attachments: true`. */
export interface XapiAttachmentBody {
  sha2: string;
  contentType: string;
  content: Uint8Array;
}

export interface XapiAttachmentInput {
  usageType: string;
  display: Record<string, string>;
  description?: Record<string, string>;
  contentType: string;
  /** Strings are encoded as UTF-8. */
  content: Uint8Array | ArrayBuffer | Blob | string;
  fileUrl?: string;
}

/** Usage type of a JWS statement-signature attachment. */
export const XAPI_SIGNATURE_USAGE_TYPE = 'http://adlnet.gov/expapi/attachments/signature';

/**
 * Hash an attachment and build both halves the LRS needs: the metadata to put
 * in `statement.attachments` and the body to send alongside it.
 */
export async function prepareXapiAttachment(
  input: XapiAttachmentInput,
): Promise<{ attachment: XapiAttachment; body: XapiAttachmentBody }> {
  const content = await toBytes(input.content);
  const sha2 = await sha256Hex(content);
  const attachment: XapiAttachment = {
    usageType: input.usageType,
    display: input.display,
    contentType: input.contentType,
    length: content.byteLength,
    sha2,
    ...(input.description ? { description: input.description } : {}),
    ...(input.fileUrl ? { fileUrl: input.fileUrl } : {}),
  };
  return { attachment, body: { sha2, contentType: input.contentType, content } };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) is required to hash xAPI attachments');
  const digest = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function toBytes(content: XapiAttachmentInput['content']): Promise<Uint8Array> {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new Uint8Array(await content.arrayBuffer());
}

export interface MultipartPart {
  /** Header names are lower-cased when decoded. */
  headers: Record<string, string>;
  body: Uint8Array;
}

const encoder = new TextEncoder();
const CRLF = encoder.encode('\r\n');

/** The statement request body: JSON first, then one binary part per attachment. */
export function encodeStatementUpload(
  statements: unknown,
  attachments: XapiAttachmentBody[],
): { contentType: string; body: Uint8Array } {
  return encodeMultipart([
    { headers: { 'Content-Type': 'application/json' }, body: encoder.encode(JSON.stringify(statements)) },
    ...attachments.map((a) => ({
      headers: {
        'Content-Type': a.contentType,
        'Content-Transfer-Encoding': 'binary',
        'X-Experience-API-Hash': a.sha2,
      },
      body: a.content,
    })),
  ]);
}

export function encodeMultipart(parts: MultipartPart[]): { contentType: string; body: Uint8Array } {
  const random = new Uint8Array(12);
  globalThis.crypto.getRandomValues(random);
  const boundary = `scormflow-${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`;

  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const head = Object.entries(part.headers)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('');
    chunks.push(encoder.encode(`--${boundary}\r\n${head}\r\n`), part.body, CRLF);
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: concat(chunks) };
}

/** Split a `multipart/mixed` body. Throws on a malformed body. */
export function decodeMultipart(body: Uint8Array, contentType: string): MultipartPart[] {
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new Error('multipart/mixed response has no boundary');

  const delimiter = encoder.encode(`--${boundary}`);
  const separator = concat([CRLF, delimiter]);
  const headerEnd = encoder.encode('\r\n\r\n');
  const decoder = new TextDecoder('latin1');

  let pos = indexOf(body, delimiter, 0);
  if (pos === -1) throw new Error('Malformed multipart body: boundary not found');
  pos += delimiter.length;

  const parts: MultipartPart[] = [];
  for (;;) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) return parts;
    const lineEnd = indexOf(body, CRLF, pos);
    if (lineEnd === -1) throw new Error('Malformed multipart body: unterminated delimiter');
    pos = lineEnd + CRLF.length;

    const next = indexOf(body, separator, pos);
    if (next === -1) throw new Error('Malformed multipart body: missing closing boundary');
    const raw = body.subarray(pos, next);
    pos = next + separator.length;

    if (raw[0] === 0x0d && raw[1] === 0x0a) {
      parts.push({ headers: {}, body: raw.subarray(2) });
      continue;
    }
    const end = indexOf(raw, headerEnd, 0);
    if (end === -1) throw new Error('Malformed multipart body: unterminated part headers');
    const headers: Record<string, string> = {};
    for (const line of decoder.decode(raw.subarray(0, end)).split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    parts.push({ headers, body: raw.subarray(end + headerEnd.length) });
  }
}

/** Decode an `attachments=true` response into its JSON part and attachment bodies. */
export function decodeStatementResponse<T>(
  body: Uint8Array,
  contentType: string,
): { json: T; attachments: XapiAttachmentBody[] } {
  const [first, ...rest] = decodeMultipart(body, contentType);
  if (!first) throw new Error('multipart/mixed response has no parts');
  return {
    json: JSON.parse(new TextDecoder().decode(first.body)) as T,
    attachments: rest.map((part) => ({
      sha2: part.headers['x-experience-api-hash'] ?? '',
      contentType: part.headers['content-type'] ?? 'application/octet-stream',
      content: part.body,
    })),
  };
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0] as number;
  const last = haystack.length - needle.length;
  let i = haystack.indexOf(first, from);
  while (i !== -1 && i <= last) {
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
    i = haystack.indexOf(first, i + 1);
  }
  return -1;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
