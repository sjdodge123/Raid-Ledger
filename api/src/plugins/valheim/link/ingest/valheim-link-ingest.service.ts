import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ValheimLinkIngestResult,
  ValheimLinkMessageKind,
} from '@raid-ledger/contract';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';
import {
  assertServerMatches,
  ingestError,
  type ValheimLinkRequest,
} from '../valheim-link-request';
import {
  assertBitmapsValid,
  assertNotFromFuture,
  parseValheimLinkMessage,
} from './valheim-link-message.parse';
import { valheimSnapshotRow } from './valheim-link-snapshot.helpers';
import {
  ValheimLinkSnapshotsRepository,
  type ValheimStoredBlob,
} from './valheim-link-snapshots.repository';

const sameShape = (ref: ValheimLinkBlobRefRow, blob: ValheimStoredBlob) =>
  ref.byteLength === blob.byteLength &&
  ref.width === blob.width &&
  ref.height === blob.height;

/**
 * ROK-1833 message ingest: contract validation, server / clock / bitmap
 * checks, blob-ref cross-check, latest-wins snapshot upsert. Logs kind,
 * server id, byte count and result only — never the payload or the token.
 */
@Injectable()
export class ValheimLinkIngestService {
  private readonly logger = new Logger(ValheimLinkIngestService.name);

  constructor(private readonly repo: ValheimLinkSnapshotsRepository) {}

  /** Ingest one decoded body posted to the `kind` route. */
  async ingest(
    req: ValheimLinkRequest,
    kind: ValheimLinkMessageKind,
    body: Buffer,
    now: Date = new Date(),
  ): Promise<ValheimLinkIngestResult> {
    const msg = parseValheimLinkMessage(kind, body);
    const auth = assertServerMatches(req, msg.serverId);
    assertNotFromFuture(msg.capturedAt, now);
    assertBitmapsValid(msg);
    const row = valheimSnapshotRow(auth.pelicanServerId, msg);
    const refs = row.blobRefs ?? [];
    const missingBlobs = await this.checkBlobs(auth.pelicanServerId, refs);
    const written = await this.repo.upsertLatest(row);
    const status = written ? 'accepted' : 'stale';
    this.logger.log(
      `valheim-link ingest kind=${kind} server=${auth.pelicanServerId} bytes=${body.length} result=${status}`,
    );
    return { status, missingBlobs };
  }

  /** 400 `blob_ref_mismatch` vs a stored blob; returns the unmet shas. */
  private async checkBlobs(
    pelicanServerId: number,
    refs: ValheimLinkBlobRefRow[],
  ): Promise<string[]> {
    const stored = await this.repo.findBlobs(
      pelicanServerId,
      refs.map((r) => r.sha256),
    );
    const bySha = new Map(stored.map((b) => [b.sha256, b]));
    const missing: string[] = [];
    for (const ref of refs) {
      const blob = bySha.get(ref.sha256);
      if (!blob) missing.push(ref.sha256);
      else if (!sameShape(ref, blob)) {
        throw new BadRequestException(
          ingestError('blob_ref_mismatch', 'ref differs from the stored blob'),
        );
      }
    }
    return missing;
  }
}
