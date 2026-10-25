/**
 * ROK-1956 §7.1 — `PUT /companion/v1/blobs/:sha256` after the guards: verify
 * in the documented order, then store content-addressed per user. The client
 * hash is never trusted: the server hashes every streamed byte and compares.
 * Bytes land in a temp file that is atomically renamed only after the row
 * commits, and the temp file is always removed. Logs ids, sizes and the
 * result only.
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  COMPANION_WEBP_MAX_BYTES,
  CompanionSha256Schema,
  type CompanionBlobAck,
} from '@raid-ledger/contract';
import {
  headerOf,
  type BoundedBodyStream,
} from '../../common/bounded-body/bounded-body.reader';
import {
  COMPANION_CONTENT_TYPE,
  type CompanionBypassedRequest,
} from '../ingest/companion-body-bypass';
import { CompanionHandlerRegistry } from '../ingest/companion-handler.registry';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import {
  companionError,
  companionUnauthorized,
} from '../ingest/companion-ingest.errors';
import {
  commitCompanionBlob,
  companionBlobFileExists,
  companionBlobTempPath,
  discardCompanionBlobFile,
} from './companion-blob.paths';
import {
  assertBlobRequestHeaders,
  assertSharpAgrees,
  readCompanionBlobToFile,
  type CompanionBlobRead,
} from './companion-blob.reader';
import { blobRefMismatch, refsAgree } from './companion-blob-refs.helpers';
import { CompanionBlobsRepository } from './companion-blobs.repository';

/** A request the blob service reads (raw body stream, guards already ran). */
export type CompanionBlobUpload = BoundedBodyStream & CompanionBypassedRequest;

/** Q6 default: 64 MiB of stored blobs per user. */
export const DEFAULT_COMPANION_BLOB_QUOTA_BYTES = 64 * 1024 * 1024;

/** Per-user byte quota (`COMPANION_BLOB_QUOTA_BYTES_PER_USER`), read per call. */
export function companionBlobQuotaBytes(): number {
  const raw = process.env.COMPANION_BLOB_QUOTA_BYTES_PER_USER;
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0
    ? n
    : DEFAULT_COMPANION_BLOB_QUOTA_BYTES;
}

/** Default global ceiling on stored companion blob bytes: 10 GiB. */
export const DEFAULT_COMPANION_BLOB_TOTAL_MAX_BYTES = 10 * 1024 * 1024 * 1024;

/** Global byte ceiling (`COMPANION_BLOB_TOTAL_MAX_BYTES`), read per call. */
export function companionBlobTotalMaxBytes(): number {
  const raw = process.env.COMPANION_BLOB_TOTAL_MAX_BYTES;
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0
    ? n
    : DEFAULT_COMPANION_BLOB_TOTAL_MAX_BYTES;
}

const quotaExceeded = () =>
  companionError('blob_quota_exceeded', 'Blob storage quota is full');
const storageFull = () =>
  companionError('blob_quota_exceeded', 'Blob storage is full');

/** Verifies and stores one companion blob upload. */
@Injectable()
export class CompanionBlobService {
  private readonly logger = new Logger(CompanionBlobService.name);

  constructor(
    private readonly repo: CompanionBlobsRepository,
    private readonly handlers: CompanionHandlerRegistry,
  ) {}

  /** Steps 1–14; `stored` (201) or `exists` (200). */
  async upload(
    auth: CompanionIngestAuth,
    rawSha: string,
    req: CompanionBlobUpload,
  ): Promise<CompanionBlobAck> {
    // R1: a session may upload only while a handler opts into `session`.
    if (auth.via === 'session' && !this.handlers.acceptsSessionBlobs()) {
      throw companionUnauthorized();
    }
    const sha256 = shaOf(rawSha);
    if (await this.alreadyStored(auth.userId, sha256)) {
      return { status: 'exists', sha256 };
    }
    const max = COMPANION_WEBP_MAX_BYTES;
    assertBlobRequestHeaders(req, max, req[COMPANION_CONTENT_TYPE]);
    await this.assertRoom(auth.userId, declaredLength(req));
    return this.receive(auth, sha256, req);
  }

  /**
   * Step 2: a row AND its file. A row whose file is gone (crash before the
   * rename, a DB restore without the files) is dropped under the user's
   * lock so this upload restores the file instead of answering `exists`
   * forever.
   */
  private async alreadyStored(
    userId: number,
    sha256: string,
  ): Promise<boolean> {
    if (!(await this.repo.find(userId, sha256))) return false;
    if (await companionBlobFileExists(userId, sha256)) return true;
    this.logger.warn(
      `companion blob user=${userId} row without file; re-accepting`,
    );
    await this.repo.removeStale(userId, sha256);
    return false;
  }

  /** Step 5 fast-fails: the user's quota, then the global disk ceiling. */
  private async assertRoom(userId: number, declared: number): Promise<void> {
    const used = await this.repo.usage(userId);
    if (used + declared > companionBlobQuotaBytes()) throw quotaExceeded();
    const total = await this.repo.totalUsage();
    if (total + declared > companionBlobTotalMaxBytes()) throw storageFull();
  }

  /** Steps 6–14: stream to a temp file, verify, store; temp always removed. */
  private async receive(
    auth: CompanionIngestAuth,
    sha256: string,
    req: CompanionBlobUpload,
  ): Promise<CompanionBlobAck> {
    const max = COMPANION_WEBP_MAX_BYTES;
    const tmpPath = await companionBlobTempPath(auth.userId);
    try {
      const got = await readCompanionBlobToFile(req, max, tmpPath);
      await this.verify(auth.userId, sha256, got, tmpPath);
      const status = await this.store(auth, got, tmpPath);
      this.logger.log(
        `companion blob user=${auth.userId} device=${auth.deviceId ?? '-'} bytes=${got.byteLength} result=${status}`,
      );
      return { status, sha256 };
    } finally {
      await discardCompanionBlobFile(tmpPath);
    }
  }

  /** Steps 9–11: server hash == path, refs agree, sharp agrees. */
  private async verify(
    userId: number,
    sha256: string,
    got: CompanionBlobRead,
    tmpPath: string,
  ): Promise<void> {
    if (got.sha256 !== sha256) {
      throw companionError(
        'hash_mismatch',
        'Body sha256 differs from the path',
      );
    }
    if (!refsAgree(await this.repo.findRefs(userId, sha256), got)) {
      throw blobRefMismatch();
    }
    await assertSharpAgrees(tmpPath, got);
  }

  /** Steps 12–13: insert under the lock, then rename into place. */
  private async store(
    auth: CompanionIngestAuth,
    got: CompanionBlobRead,
    tmpPath: string,
  ): Promise<CompanionBlobAck['status']> {
    const result = await this.repo.insert(auth, got, companionBlobQuotaBytes());
    if (result === 'revoked') throw companionUnauthorized();
    if (result === 'quota_exceeded') throw quotaExceeded();
    if (result === 'ref_mismatch') throw blobRefMismatch();
    if (result === 'stored') await this.place(auth.userId, got.sha256, tmpPath);
    return result;
  }

  /** Post-commit rename; on failure delete the row + temp, generic 500. */
  private async place(
    userId: number,
    sha256: string,
    tmpPath: string,
  ): Promise<void> {
    try {
      await commitCompanionBlob(tmpPath, userId, sha256);
    } catch (err: unknown) {
      await this.repo.remove(userId, sha256);
      await discardCompanionBlobFile(tmpPath);
      const reason = err instanceof Error && 'code' in err ? err.code : '-';
      this.logger.error(
        `companion blob user=${userId} rename failed code=${String(reason)}`,
      );
      throw new InternalServerErrorException('Blob could not be stored');
    }
  }
}

function shaOf(raw: string): string {
  const parsed = CompanionSha256Schema.safeParse(raw);
  if (!parsed.success) {
    throw companionError('hash_mismatch', 'Path is not a lowercase hex sha256');
  }
  return parsed.data;
}

/** Declared `Content-Length` (preflight only; 0 when absent). */
function declaredLength(req: BoundedBodyStream): number {
  const n = Number(headerOf(req, 'content-length'));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
