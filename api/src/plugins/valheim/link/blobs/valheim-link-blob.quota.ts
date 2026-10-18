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

function positiveIntEnv(name: string, fallback: number): number {
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

/** The declared `Content-Length`, or 0 when absent / not a number. */
export function declaredLength(
  headers: Record<string, string | string[] | undefined>,
): number {
  const raw = headers['content-length'];
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * 413 `quota_exceeded` when the server is at its blob count, or when its
 * stored bytes plus this upload's declared length pass the byte cap.
 * Runs before the body is read. Retention of unreferenced blobs is Q15.
 */
export function assertUnderQuota(
  usage: ValheimBlobUsage,
  incomingBytes: number,
): void {
  const { maxBytes, maxBlobs } = blobQuota();
  if (usage.count < maxBlobs && usage.bytes + incomingBytes <= maxBytes) {
    return;
  }
  throw new HttpException(
    ingestError('quota_exceeded', 'Blob storage quota for this server is full'),
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}
