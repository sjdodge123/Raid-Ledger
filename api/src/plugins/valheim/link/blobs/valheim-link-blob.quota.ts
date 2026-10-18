import { HttpException, HttpStatus } from '@nestjs/common';
import { ingestError } from '../valheim-link-request';

/** What one server already stores (`SUM(byte_length)`, `COUNT(*)`). */
export interface ValheimBlobUsage {
  bytes: number;
  count: number;
}

/** Defaults: 2 GiB and 2 000 blobs per server (ROK-1833 review). */
export const DEFAULT_MAX_BLOB_BYTES_PER_SERVER = 2 * 1024 ** 3;
export const DEFAULT_MAX_BLOBS_PER_SERVER = 2000;

/** A positive integer env var, else `fallback`. */
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Per-server caps, read per call (env-overridable; never lifted by flags). */
export function blobQuota(): { maxBytes: number; maxBlobs: number } {
  return {
    maxBytes: positiveIntEnv(
      'VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER',
      DEFAULT_MAX_BLOB_BYTES_PER_SERVER,
    ),
    maxBlobs: positiveIntEnv(
      'VALHEIM_LINK_MAX_BLOBS_PER_SERVER',
      DEFAULT_MAX_BLOBS_PER_SERVER,
    ),
  };
}

/**
 * The declared `Content-Length`, or 0 when absent / not a number. Preflight
 * only: an absent length checks just the count cap (and bytes already over);
 * the post-read check in the write transaction (`fitsQuota`) is authoritative.
 */
export function declaredLength(
  headers: Record<string, string | string[] | undefined>,
): number {
  const raw = headers['content-length'];
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** True when one more blob of `incomingBytes` stays within both caps. */
export function fitsQuota(
  usage: ValheimBlobUsage,
  incomingBytes: number,
): boolean {
  const { maxBytes, maxBlobs } = blobQuota();
  return usage.count + 1 <= maxBlobs && usage.bytes + incomingBytes <= maxBytes;
}

/** 413 `quota_exceeded` with `message`. */
export function quotaExceeded(message: string): HttpException {
  return new HttpException(
    ingestError('quota_exceeded', message),
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}

/**
 * Preflight, before the body is read: 413 `quota_exceeded` when the server
 * is at its blob count, or its stored bytes plus the declared length pass
 * the byte cap. Retention of unreferenced blobs is Q15.
 */
export function assertUnderQuota(
  usage: ValheimBlobUsage,
  incomingBytes: number,
): void {
  if (fitsQuota(usage, incomingBytes)) return;
  throw quotaExceeded('Blob storage quota for this server is full');
}
