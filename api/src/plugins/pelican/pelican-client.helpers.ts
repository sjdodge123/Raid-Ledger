import type { PelicanErrorKind } from '@raid-ledger/contract';

/** Largest Pelican response body we will buffer (1 MiB). */
export const PELICAN_MAX_BODY_BYTES = 1_048_576;

/** How deep {@link fetchErrorKind} follows an error's `cause` chain. */
const MAX_CAUSE_DEPTH = 4;

export type BodyRead =
  { ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid' };

/**
 * Map a `fetch` (or body-read) rejection to a kind.
 *
 * Duck-typed on purpose: under Jest (and any other vm context) the errors
 * undici throws come from Node's own realm, so `err instanceof Error` is
 * false and `err.cause` must be read as a plain property. Only `name` and
 * `message` are inspected; neither is logged or returned.
 */
export function fetchErrorKind(err: unknown): PelicanErrorKind {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    const name = stringField(current, 'name');
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    // undici: TypeError('fetch failed', { cause: Error('unexpected redirect') })
    const message = stringField(current, 'message');
    if (message !== undefined && /^unexpected redirect\b/i.test(message)) {
      return 'redirect';
    }
    current = field(current, 'cause');
    if (current === undefined) break;
  }
  return 'network';
}

/**
 * Read a JSON body, buffering at most `maxBytes`. Past the cap the stream is
 * cancelled and `too_large` returned. Rejects only when `signal` aborts (or
 * the stream itself errors) mid-read, so the caller can report `timeout`.
 */
export async function readBoundedJson(
  res: Response,
  signal: AbortSignal,
  maxBytes = PELICAN_MAX_BODY_BYTES,
): Promise<BodyRead> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(res);
    return { ok: false, reason: 'too_large' };
  }
  const bytes = res.body ? await readCapped(res.body, signal, maxBytes) : null;
  if (bytes === 'too_large') return { ok: false, reason: 'too_large' };
  try {
    const text = bytes ? new TextDecoder().decode(bytes) : '';
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Release an unread body so undici frees the socket. Never throws. */
export async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Already consumed or errored — nothing left to release.
  }
}

async function readCapped(
  body: ReadableStream,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array | 'too_large'> {
  const reader = body.getReader();
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk: unknown = (await reader.read()).value;
      signal.throwIfAborted();
      if (chunk === undefined) break;
      const bytes = toBytes(chunk);
      total += bytes.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return 'too_large';
      }
      chunks.push(bytes);
    }
    return concat(chunks, total);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Cross-realm safe: `ArrayBuffer.isView` works where `instanceof` fails. */
function toBytes(chunk: unknown): Uint8Array {
  if (!ArrayBuffer.isView(chunk)) throw new TypeError('Unexpected body chunk');
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, key);
}

function stringField(value: unknown, key: 'name' | 'message') {
  const v = field(value, key);
  return typeof v === 'string' ? v : undefined;
}
