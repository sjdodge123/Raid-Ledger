import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Duplex, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { ingestError } from '../valheim-link-request';
import {
  VALHEIM_LINK_CONTENT_TYPE,
  type ValheimLinkBypassedRequest,
} from './valheim-link-body-bypass';

/** The stream + headers the reader needs (an Express request satisfies it). */
export type BoundedBodySource = Readable & ValheimLinkBypassedRequest;

/** Options for {@link readBoundedBody}. */
export interface BoundedBodyOptions {
  /** CONTRACT §7 cap on the DECODED bytes (also the wire cap). */
  maxBytes: number;
  /** Media type the route accepts, e.g. `application/json`. */
  contentType: string;
}

/** 413 `payload_too_large`. */
export const tooLarge = (): PayloadTooLargeException =>
  new PayloadTooLargeException(
    ingestError('payload_too_large', 'body exceeds the cap for this route'),
  );

/** 415 `unsupported_media`. */
export const unsupported = (what: string): UnsupportedMediaTypeException =>
  new UnsupportedMediaTypeException(
    ingestError('unsupported_media', `unsupported ${what}`),
  );

/** A request header, joined, trimmed and lower-cased (`''` when absent). */
export function headerOf(src: BoundedBodySource, name: string): string {
  const value = src.headers[name];
  return (Array.isArray(value) ? value.join(',') : (value ?? ''))
    .trim()
    .toLowerCase();
}

/** `gzip` or `identity`; anything else is 415. */
function encodingOf(src: BoundedBodySource): 'gzip' | 'identity' {
  const encoding = headerOf(src, 'content-encoding');
  if (encoding === '' || encoding === 'identity') return 'identity';
  if (encoding === 'gzip') return 'gzip';
  throw unsupported('content-encoding');
}

/** 415 unless the (bypassed) media type is `want`. */
export function assertContentType(src: BoundedBodySource, want: string): void {
  const raw = src[VALHEIM_LINK_CONTENT_TYPE] ?? headerOf(src, 'content-type');
  const type = (raw.split(';')[0] ?? '').trim().toLowerCase();
  if (type !== want) throw unsupported('content-type');
}

/** 413 when `Content-Length` declares more than `max`. */
export function assertDeclaredLength(
  src: BoundedBodySource,
  max: number,
): void {
  const declared = Number(headerOf(src, 'content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
}

/**
 * Read a request body with the kind's cap on the DECODED bytes (CONTRACT §1,
 * §7). `Content-Length` over the cap → 413 before reading; a streamed body or
 * a gzip inflation that crosses the cap → 413 the moment it does (the rest is
 * never buffered); a corrupt gzip → 400 `bad_gzip`; other encodings or a
 * wrong media type → 415.
 */
export async function readBoundedBody(
  src: BoundedBodySource,
  opts: BoundedBodyOptions,
): Promise<Buffer> {
  const encoding = encodingOf(src);
  assertContentType(src, opts.contentType);
  assertDeclaredLength(src, opts.maxBytes);
  if (encoding === 'identity') return collect(src, src, opts.maxBytes);
  const gunzip = createGunzip();
  src.pipe(gunzip);
  return collect(src, gunzip, opts.maxBytes);
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
function collect(src: Readable, out: Readable, max: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const decoded = new CappedSink(max);
    let wireBytes = 0;
    const stop = (err: Error): void => {
      out.removeAllListeners('data');
      if (out instanceof Duplex && out !== src) detach(src, out);
      src.pause();
      reject(err);
    };
    if (out !== src) {
      src.on('data', (chunk: Buffer) => {
        wireBytes += chunk.length;
        if (wireBytes > max) stop(tooLarge());
      });
      src.once('error', stop);
    }
    out.on('data', (chunk: Buffer) => {
      if (!decoded.push(chunk)) stop(tooLarge());
    });
    out.once('end', () => resolve(decoded.result()));
    out.once('error', (err: Error) => stop(out === src ? err : badGzip()));
  });
}

function detach(src: Readable, out: Duplex): void {
  src.unpipe(out);
  src.removeAllListeners('data');
  out.destroy();
}

const badGzip = (): BadRequestException =>
  new BadRequestException(ingestError('bad_gzip', 'body is not valid gzip'));
