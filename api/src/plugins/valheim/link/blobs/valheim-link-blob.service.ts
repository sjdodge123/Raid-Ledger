import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  VALHEIM_LINK_BINARY_MAX_BYTES,
  VALHEIM_LINK_BITMAP_EDGE_MAX,
  ValheimSha256Schema,
  type ValheimLinkBlobResult,
} from '@raid-ledger/contract';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';
import type { BoundedBodySource } from '../ingest/valheim-link-body.reader';
import {
  ingestError,
  type ValheimLinkAuth,
  type ValheimLinkRequest,
} from '../valheim-link-request';
import {
  readBlobToFile,
  type BlobReadResult,
} from './valheim-link-blob.reader';
import {
  blobRelativePath,
  blobTempPath,
  commitBlob,
  discardBlob,
} from './valheim-link-blob.store';
import {
  assertUnderQuota,
  declaredLength,
  quotaExceeded,
} from './valheim-link-blob.quota';
import {
  ValheimLinkBlobsRepository,
  type ValheimBlobInsertResult,
} from './valheim-link-blobs.repository';
import { VALHEIM_BLOB_EDGE_MAX } from './valheim-link-png.helpers';

/** A request the blob service reads (Express request after the guards). */
export type ValheimBlobUpload = BoundedBodySource & ValheimLinkRequest;

const mismatch = (code: 'hash_mismatch' | 'blob_ref_mismatch', m: string) =>
  new BadRequestException(ingestError(code, m));

/** 4096 when any ref uses the blob as a base map (CONTRACT §7), else 16 384. */
export function maxEdgeFor(refs: ValheimLinkBlobRefRow[]): number {
  return refs.some((r) => r.role === 'baseMap')
    ? VALHEIM_LINK_BITMAP_EDGE_MAX
    : VALHEIM_BLOB_EDGE_MAX;
}

/** Every ref must agree with the bytes received (byteLength + IHDR dims). */
export function refsAgree(
  refs: ValheimLinkBlobRefRow[],
  got: BlobReadResult,
): boolean {
  return refs.every(
    (r) =>
      r.byteLength === got.byteLength &&
      r.width === got.width &&
      r.height === got.height,
  );
}

/**
 * `PUT …/blobs/:sha256` (CONTRACT §1): verify, then store content-addressed
 * at `<serverId>/<sha256>.png` under the blob root. Either order relative to
 * the referencing message; an already-stored sha answers `exists`.
 */
@Injectable()
export class ValheimLinkBlobService {
  private readonly logger = new Logger(ValheimLinkBlobService.name);

  constructor(private readonly repo: ValheimLinkBlobsRepository) {}

  /** Read, verify and store one upload. */
  async upload(
    req: ValheimBlobUpload,
    rawSha: string,
  ): Promise<ValheimLinkBlobResult> {
    const sha256 = shaOf(rawSha);
    const auth = authOf(req);
    assertUnderQuota(
      await this.repo.usage(auth.pelicanServerId),
      declaredLength(req.headers),
    );
    const refs = await this.repo.findRefs(auth.pelicanServerId, sha256);
    const tmpPath = await blobTempPath(auth.pelicanServerId);
    const got = await readBlobToFile(req, {
      maxBytes: VALHEIM_LINK_BINARY_MAX_BYTES,
      maxEdge: maxEdgeFor(refs),
      tmpPath,
    });
    try {
      verify(sha256, refs, got);
      const status = await this.store(auth, got, tmpPath);
      if (refs.length > 0) await this.repo.touch(auth.pelicanServerId, sha256);
      this.logger.log(
        `valheim-link blob server=${auth.pelicanServerId} status=${status} refs=${refs.length}`,
      );
      return { status, sha256 };
    } finally {
      await discardBlob(tmpPath);
    }
  }

  /**
   * Insert the row (quota re-checked on the actual bytes), then — after
   * the commit — rename into place; `exists` when already stored.
   */
  private async store(
    auth: ValheimLinkAuth,
    got: BlobReadResult,
    tmpPath: string,
  ): Promise<ValheimLinkBlobResult['status']> {
    const { pelicanServerId, tokenId, tokenHash } = auth;
    if (await this.repo.find(pelicanServerId, got.sha256)) return 'exists';
    const storagePath = blobRelativePath(pelicanServerId, got.sha256);
    const result = await this.repo.insertIfTokenActive(
      {
        pelicanServerId,
        sha256: got.sha256,
        byteLength: got.byteLength,
        contentType: 'image/png',
        width: got.width,
        height: got.height,
        storagePath,
      },
      { tokenId, tokenHash },
    );
    assertAdmitted(result);
    if (result === 'stored') await this.place(pelicanServerId, got, tmpPath);
    return result;
  }

  /**
   * Post-commit rename. On failure, compensate: delete the just-committed
   * row and the temp file, answer a generic 500 (no paths). A crash between
   * commit and rename is not reconciled here (follow-up).
   */
  private async place(
    pelicanServerId: number,
    got: BlobReadResult,
    tmpPath: string,
  ): Promise<void> {
    try {
      await commitBlob(tmpPath, blobRelativePath(pelicanServerId, got.sha256));
    } catch (err: unknown) {
      await this.repo.remove(pelicanServerId, got.sha256);
      await discardBlob(tmpPath);
      const reason = err instanceof Error && 'code' in err ? err.code : '-';
      this.logger.error(
        `valheim-link blob server=${pelicanServerId} rename failed code=${String(reason)}`,
      );
      throw new InternalServerErrorException('Blob could not be stored');
    }
  }
}

/** 401 when the token died before commit; 413 when the actual bytes don't fit. */
function assertAdmitted(
  result: ValheimBlobInsertResult,
): asserts result is 'stored' | 'exists' {
  if (result === 'revoked') {
    throw new UnauthorizedException(
      ingestError('invalid_token', 'Invalid token'),
    );
  }
  if (result === 'quota_exceeded') {
    throw quotaExceeded('Blob storage quota for this server is full');
  }
}

function shaOf(raw: string): string {
  const parsed = ValheimSha256Schema.safeParse(raw);
  if (!parsed.success) {
    throw mismatch('hash_mismatch', 'path is not a lowercase hex sha256');
  }
  return parsed.data;
}

function authOf(req: ValheimLinkRequest): ValheimLinkAuth {
  if (!req.valheimLink) {
    throw new ForbiddenException(
      ingestError('server_mismatch', 'no Valheim Link server on this request'),
    );
  }
  return req.valheimLink;
}

function verify(
  sha256: string,
  refs: ValheimLinkBlobRefRow[],
  got: BlobReadResult,
): void {
  if (got.sha256 !== sha256) {
    throw mismatch('hash_mismatch', 'body sha256 differs from the path');
  }
  if (!refsAgree(refs, got)) {
    throw mismatch('blob_ref_mismatch', 'blob differs from a snapshot ref');
  }
}
