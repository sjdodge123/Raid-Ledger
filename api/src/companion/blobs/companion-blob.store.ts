/**
 * ROK-1956 D-14 — the exported read side of the private blob store. C3 has no
 * read route: an owning plugin (C4/C6) opens a verified blob here and MUST
 * re-encode it with sharp (`encodeHubMedia`) before anything is shown; raw
 * bytes are never served. Member visibility is the plugin's guard.
 */
import { Injectable } from '@nestjs/common';
import type { ReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { COMPANION_BLOB_CONTENT_TYPE } from '../../drizzle/schema/companion-ingest';
import { CompanionSha256Schema } from '@raid-ledger/contract';
import { companionBlobAbsolutePath, fsErrorCode } from './companion-blob.paths';
import {
  CompanionBlobsRepository,
  releaseUnusedRefsIn,
  type CompanionBlobDims,
  type CompanionRefRelease,
} from './companion-blobs.repository';

/** An opened blob: its verified metadata plus a read stream of the raw bytes. */
export interface CompanionBlobHandle extends CompanionBlobDims {
  sha256: string;
  contentType: typeof COMPANION_BLOB_CONTENT_TYPE;
  stream: ReadStream;
}

/** Plugin-facing blob access (`open`) and ref release (`releaseRefs`). */
@Injectable()
export class CompanionBlobStore {
  constructor(private readonly repo: CompanionBlobsRepository) {}

  /**
   * The user's stored blob, or null when the sha is malformed, there is no
   * row, or the file is missing (e.g. a crash before the rename). Scoped to
   * `userId` — one user's sha never opens another user's copy.
   */
  async open(
    userId: number,
    sha256: string,
  ): Promise<CompanionBlobHandle | null> {
    if (!CompanionSha256Schema.safeParse(sha256).success) return null;
    const dims = await this.repo.find(userId, sha256);
    if (!dims) return null;
    const handle = await open(
      companionBlobAbsolutePath(userId, sha256),
      'r',
    ).catch((err: unknown) => {
      if (fsErrorCode(err) === 'ENOENT') return null;
      throw err;
    });
    if (!handle) return null;
    const stream = handle.createReadStream({ autoClose: true });
    return {
      ...dims,
      sha256,
      contentType: COMPANION_BLOB_CONTENT_TYPE,
      stream,
    };
  }

  /**
   * Drop `contract`'s refs to `shas` for this user (C4 owns retention). A blob
   * left with no ref is reaped by the daily cleanup after 24 h. Returns the
   * number of refs removed.
   */
  releaseRefs(
    userId: number,
    contract: string,
    shas: readonly string[],
  ): Promise<number> {
    return this.repo.releaseRefs(userId, contract, shas);
  }

  /** D-11 tx variant of `releaseRefs` for a plugin's prune transaction. */
  releaseUnusedRefsIn(
    tx: Parameters<typeof releaseUnusedRefsIn>[0],
    release: CompanionRefRelease,
  ): Promise<number> {
    return releaseUnusedRefsIn(tx, release);
  }
}
