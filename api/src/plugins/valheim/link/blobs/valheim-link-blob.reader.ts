import { createHash, type Hash } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import {
  assertContentType,
  assertDeclaredLength,
  headerOf,
  tooLarge,
  unsupported,
  type BoundedBodySource,
} from '../ingest/valheim-link-body.reader';
import {
  PNG_HEADER_BYTES,
  parsePngHeader,
  signatureSoFarOk,
  type PngDimensions,
} from './valheim-link-png.helpers';

/** Options for {@link readBlobToFile}. */
export interface BlobReadOptions {
  /** CONTRACT §7 `VALHEIM_LINK_BINARY_MAX_BYTES`. */
  maxBytes: number;
  /** Largest allowed IHDR edge (4096 for a base map, else 16 384). */
  maxEdge: number;
  /** Temp file the bytes stream into (created exclusively). */
  tmpPath: string;
}

/** What was read: the hash and length of the bytes plus IHDR dims. */
export interface BlobReadResult extends PngDimensions {
  sha256: string;
  byteLength: number;
}

/**
 * Stream a PNG upload into `tmpPath` while hashing it. Identity encoding and
 * `image/png` only (415); `Content-Length` or streamed bytes over `maxBytes`
 * → 413 the moment they cross (reading stops); the signature + IHDR are
 * checked on the first {@link PNG_HEADER_BYTES} before a byte is written.
 * On any failure the temp file is removed.
 */
export async function readBlobToFile(
  src: BoundedBodySource,
  opts: BlobReadOptions,
): Promise<BlobReadResult> {
  const encoding = headerOf(src, 'content-encoding');
  if (encoding !== '' && encoding !== 'identity') {
    throw unsupported('content-encoding');
  }
  assertContentType(src, 'image/png');
  assertDeclaredLength(src, opts.maxBytes);
  // Opened up front so the cleanup below can never race a lazy open.
  const handle = await open(opts.tmpPath, 'wx');
  const out = handle.createWriteStream();
  try {
    return await pump(src, out, opts);
  } catch (err: unknown) {
    out.destroy();
    await rm(opts.tmpPath, { force: true });
    throw err;
  }
}

/** Running state of one upload. */
class BlobSink {
  readonly hash: Hash = createHash('sha256');
  size = 0;
  private head: Buffer[] = [];
  dims: PngDimensions | null = null;

  constructor(
    private readonly out: WriteStream,
    private readonly opts: BlobReadOptions,
  ) {}

  /** Take a chunk; false = backpressure. Throws on cap/header failures. */
  push(chunk: Buffer): boolean {
    this.size += chunk.length;
    if (this.size > this.opts.maxBytes) throw tooLarge();
    this.hash.update(chunk);
    if (this.dims) return this.out.write(chunk);
    this.head.push(chunk);
    const head = Buffer.concat(this.head);
    if (!signatureSoFarOk(head)) parsePngHeader(head, this.opts.maxEdge);
    if (head.length < PNG_HEADER_BYTES) return true;
    this.dims = parsePngHeader(head, this.opts.maxEdge);
    this.head = [];
    return this.out.write(head);
  }

  /** At EOF: a body shorter than the header still gets its 400. */
  finish(): PngDimensions {
    return this.dims ?? parsePngHeader(Buffer.concat(this.head), this.opts.maxEdge);
  }
}

function pump(
  src: BoundedBodySource,
  out: WriteStream,
  opts: BlobReadOptions,
): Promise<BlobReadResult> {
  return new Promise<BlobReadResult>((resolve, reject) => {
    const sink = new BlobSink(out, opts);
    const fail = (err: unknown): void => {
      src.removeAllListeners('data');
      src.pause();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    src.on('data', (chunk: Buffer) => {
      try {
        if (!sink.push(chunk)) {
          src.pause();
          out.once('drain', () => src.resume());
        }
      } catch (err: unknown) {
        fail(err);
      }
    });
    src.once('error', fail);
    out.once('error', fail);
    src.once('end', () => {
      try {
        const dims = sink.finish();
        const sha256 = sink.hash.digest('hex');
        out.end(() => resolve({ ...dims, sha256, byteLength: sink.size }));
      } catch (err: unknown) {
        fail(err);
      }
    });
  });
}
