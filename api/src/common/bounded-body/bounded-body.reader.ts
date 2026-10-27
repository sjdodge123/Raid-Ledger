import { Duplex, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

/**
 * Shared streaming request-body reader (ROK-1956, extracted from Valheim
 * Link's ROK-1833 reader). The route supplies the errors, so the same cap
 * logic answers in each route's own error vocabulary.
 */

/** The stream + headers the reader needs (an Express request satisfies it). */
export type BoundedBodyStream = Readable & {
  headers: Record<string, string | string[] | undefined>;
};

/** Route-specific refusals. Each returns the error to throw/reject with. */
export interface BoundedBodyErrors {
  /** The declared, wire or decoded size passed the cap (413). */
  tooLarge(): Error;
  /** `what` is `content-encoding` or `content-type` (415). */
  unsupported(what: 'content-encoding' | 'content-type'): Error;
  /** A gzip body that does not inflate (400). */
  badGzip(): Error;
}

/** Options for {@link readBoundedBody}. */
export interface BoundedBodyReadOptions {
  /** Cap on the DECODED bytes (also the wire cap). */
  maxBytes: number;
  /** Media type the route accepts, e.g. `application/json`. */
  contentType: string;
  errors: BoundedBodyErrors;
  /** Media type a body-parser bypass moved off the headers, if any. */
  rawContentType?: string | undefined;
}

/** A request header, joined, trimmed and lower-cased (`''` when absent). */
export function headerOf(src: BoundedBodyStream, name: string): string {
  const value = src.headers[name];
  return (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .trim()
    .toLowerCase();
}

/** `gzip` or `identity`; anything else is `unsupported('content-encoding')`. */
export function encodingOf(
  src: BoundedBodyStream,
  errors: BoundedBodyErrors,
): 'gzip' | 'identity' {
  const encoding = headerOf(src, 'content-encoding');
  if (encoding === '' || encoding === 'identity') return 'identity';
  if (encoding === 'gzip') return 'gzip';
  throw errors.unsupported('content-encoding');
}

/** Throws `unsupported('content-type')` unless the media type is `want`. */
export function assertMediaType(
  src: BoundedBodyStream,
  want: string,
  errors: BoundedBodyErrors,
  rawContentType?: string,
): void {
  const raw = rawContentType ?? headerOf(src, 'content-type');
  const type = (raw.split(';')[0] ?? '').trim().toLowerCase();
  if (type !== want) throw errors.unsupported('content-type');
}

/** Throws `tooLarge()` when `Content-Length` declares more than `max`. */
export function assertDeclaredLength(
  src: BoundedBodyStream,
  max: number,
  errors: BoundedBodyErrors,
): void {
  const declared = Number(headerOf(src, 'content-length'));
  if (Number.isFinite(declared) && declared > max) throw errors.tooLarge();
}

/**
 * Read a request body with a cap on the DECODED bytes. `Content-Length` over
 * the cap → `tooLarge` before reading; a streamed body or a gzip inflation
 * that crosses the cap → `tooLarge` the moment it does (the rest is never
 * buffered); a corrupt gzip → `badGzip`; other encodings or a wrong media
 * type → `unsupported`.
 */
export async function readBoundedBody(
  src: BoundedBodyStream,
  opts: BoundedBodyReadOptions,
): Promise<Buffer> {
  const { errors, maxBytes } = opts;
  const encoding = encodingOf(src, errors);
  assertMediaType(src, opts.contentType, errors, opts.rawContentType);
  assertDeclaredLength(src, maxBytes, errors);
  if (encoding === 'identity') return collect(src, src, maxBytes, errors);
  const gunzip = createGunzip();
  src.pipe(gunzip);
  return collect(src, gunzip, maxBytes, errors);
}

/** Accumulates chunks up to `max`; reports whether the cap was crossed. */
class CappedSink {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly max: number) {}

  /** False once the running total passes the cap (the chunk is dropped). */
  push(chunk: Buffer): boolean {
    this.size += chunk.length;
    if (this.size > this.max) return false;
    this.chunks.push(chunk);
    return true;
  }

  /** The collected bytes. */
  result(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }
}

/** Pull `out` into one Buffer; stop reading `src` once `max` is crossed. */
function collect(
  src: Readable,
  out: Readable,
  max: number,
  errors: BoundedBodyErrors,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const decoded = new CappedSink(max);
    const stop = (err: Error): void => {
      out.removeAllListeners('data');
      if (out instanceof Duplex && out !== src) detach(src, out);
      src.pause();
      reject(err);
    };
    if (out !== src) watchWire(src, max, stop, errors);
    out.on('data', (chunk: Buffer) => {
      if (!decoded.push(chunk)) stop(errors.tooLarge());
    });
    out.once('end', () => resolve(decoded.result()));
    out.once('error', (err: Error) =>
      stop(out === src ? err : errors.badGzip()),
    );
  });
}

/** Caps the compressed (wire) bytes too, and forwards wire errors. */
function watchWire(
  src: Readable,
  max: number,
  stop: (err: Error) => void,
  errors: BoundedBodyErrors,
): void {
  let wireBytes = 0;
  src.on('data', (chunk: Buffer) => {
    wireBytes += chunk.length;
    if (wireBytes > max) stop(errors.tooLarge());
  });
  src.once('error', stop);
}

function detach(src: Readable, out: Duplex): void {
  src.unpipe(out);
  src.removeAllListeners('data');
  out.destroy();
}
