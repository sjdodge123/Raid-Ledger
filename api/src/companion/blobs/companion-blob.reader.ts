/**
 * ROK-1956 §7.1 steps 3–8 + 11 — the blob body. Pre-read checks (identity
 * encoding, `image/webp`, declared length), then a streaming read into an
 * exclusively-created temp file that hashes EVERY chunk (the client's hash is
 * never trusted), caps the streamed bytes, and checks the WebP header on the
 * first {@link WEBP_HEADER_BYTES} before a single byte is written. The temp
 * file is removed on any failure. Modelled on `valheim-link-blob.reader.ts`.
 */
import { createHash, type Hash } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { COMPANION_IMAGE_EDGE_MAX } from '@raid-ledger/contract';
import sharp from 'sharp';
import {
  assertDeclaredLength,
  assertMediaType,
  encodingOf,
  type BoundedBodyStream,
} from '../../common/bounded-body/bounded-body.reader';
import {
  companionBodyErrors,
  companionError,
} from '../ingest/companion-ingest.errors';
import {
  WEBP_HEADER_BYTES,
  parseWebpHeader,
  riffLengthMatches,
  webpSignatureSoFarOk,
  type WebpHeader,
} from './companion-webp.helpers';

/** What was read: the server-computed hash, length and header dims. */
export interface CompanionBlobRead {
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
}

const invalidBlob = (): Error =>
  companionError('invalid_blob', 'Blob is not a supported still WebP');

/** Steps 3–4 (before any byte is read): 415 encoding/type, 413 declared length. */
export function assertBlobRequestHeaders(
  src: BoundedBodyStream,
  maxBytes: number,
  rawContentType?: string,
): void {
  if (encodingOf(src, companionBodyErrors) !== 'identity') {
    throw companionBodyErrors.unsupported('content-encoding');
  }
  assertMediaType(src, 'image/webp', companionBodyErrors, rawContentType);
  assertDeclaredLength(src, maxBytes, companionBodyErrors);
}

/** Steps 6–8: stream `src` into `tmpPath` (opened `wx`) while hashing. */
export async function readCompanionBlobToFile(
  src: BoundedBodyStream,
  maxBytes: number,
  tmpPath: string,
): Promise<CompanionBlobRead> {
  const handle = await open(tmpPath, 'wx');
  const out = handle.createWriteStream();
  try {
    return await pump(src, out, new BlobSink(out, maxBytes));
  } catch (err: unknown) {
    out.destroy();
    await rm(tmpPath, { force: true });
    throw err;
  }
}

/**
 * Step 11: sharp reads the container metadata only (no pixel decode) and
 * must agree it is a WebP of the header's dimensions; else 400 `invalid_blob`.
 */
export async function assertSharpAgrees(
  tmpPath: string,
  got: CompanionBlobRead,
): Promise<void> {
  const limitInputPixels = COMPANION_IMAGE_EDGE_MAX * COMPANION_IMAGE_EDGE_MAX;
  const meta = await sharp(tmpPath, { limitInputPixels })
    .metadata()
    .catch(() => null);
  const ok =
    meta?.format === 'webp' &&
    meta.width === got.width &&
    meta.height === got.height;
  if (!ok) throw invalidBlob();
}

/** Running state of one upload. */
class BlobSink {
  readonly hash: Hash = createHash('sha256');
  size = 0;
  header: WebpHeader | null = null;
  private head: Buffer[] = [];

  constructor(
    private readonly out: WriteStream,
    private readonly maxBytes: number,
  ) {}

  /** Take a chunk; false = backpressure. Throws on cap/header failures. */
  push(chunk: Buffer): boolean {
    this.size += chunk.length;
    if (this.size > this.maxBytes) throw companionBodyErrors.tooLarge();
    this.hash.update(chunk);
    if (this.header) return this.out.write(chunk);
    this.head.push(chunk);
    const head = Buffer.concat(this.head);
    if (!webpSignatureSoFarOk(head)) throw invalidBlob();
    if (head.length < WEBP_HEADER_BYTES) return true;
    this.header = headerOrThrow(head);
    this.head = [];
    return this.out.write(head);
  }

  /** At EOF: a short body or a RIFF size that disagrees → 400. */
  finish(): CompanionBlobRead {
    const header = this.header ?? headerOrThrow(Buffer.concat(this.head));
    if (!riffLengthMatches(header.riffSize, this.size)) throw invalidBlob();
    const { width, height } = header;
    return { sha256: this.hash.digest('hex'), byteLength: this.size, width, height };
  }
}

function headerOrThrow(head: Buffer): WebpHeader {
  const parsed = parseWebpHeader(head, COMPANION_IMAGE_EDGE_MAX);
  if (!parsed.ok) throw invalidBlob();
  return parsed;
}

/** Stop reading `src` (the rest is never buffered) and reject. */
function stopper(
  src: BoundedBodyStream,
  reject: (err: Error) => void,
): (err: unknown) => void {
  return (err: unknown): void => {
    src.removeAllListeners('data');
    src.pause();
    reject(err instanceof Error ? err : new Error(String(err)));
  };
}

function pump(
  src: BoundedBodyStream,
  out: WriteStream,
  sink: BlobSink,
): Promise<CompanionBlobRead> {
  return new Promise<CompanionBlobRead>((resolve, reject) => {
    const fail = stopper(src, reject);
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
        const result = sink.finish();
        out.end(() => resolve(result));
      } catch (err: unknown) {
        fail(err);
      }
    });
  });
}
