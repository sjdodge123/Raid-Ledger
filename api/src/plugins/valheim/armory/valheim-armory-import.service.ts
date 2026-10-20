import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ValheimLinkMessage } from '@raid-ledger/contract';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import {
  toCatalogValues,
  toMapValues,
  toProfileValues,
  validateSnapshotPayload,
  type ArmorySnapshot,
} from './valheim-armory.mappers';
import {
  VALHEIM_PROFILE_UPSERTED_HOOK,
  type ValheimProfileUpsertedHook,
} from './valheim-armory-profile.hook';
import {
  ValheimArmoryRepository,
  type ArmoryCandidate,
  type ArmorySnapshotStatus,
} from './valheim-armory.repository';

/** Snapshots per drain (D1, FLAG Q12). */
export const ARMORY_DRAIN_BATCH = 50;

/** Per-row result; `busy` = locked elsewhere or replaced by ingest mid-read. */
export type ArmoryImportOutcome = ArmorySnapshotStatus | 'busy';

/** Count of each outcome in one drain. */
export type ArmoryDrainSummary = Record<ArmoryImportOutcome, number>;

interface Applied {
  status: ArmorySnapshotStatus;
  detail: string | null;
}

/**
 * ROK-1835 importer: drains `valheim_link_snapshots` into the armory tables.
 * ONE transaction per snapshot row (a bad row never rolls back others);
 * every payload is re-validated with its contract schema first (R7).
 */
@Injectable()
export class ValheimArmoryImportService {
  private readonly logger = new Logger(ValheimArmoryImportService.name);

  constructor(
    private readonly repo: ValheimArmoryRepository,
    @Inject(VALHEIM_PROFILE_UPSERTED_HOOK)
    private readonly hook: ValheimProfileUpsertedHook,
  ) {}

  /** One drain pass over up to `limit` importable snapshots (specs call this). */
  async drainOnce(limit = ARMORY_DRAIN_BATCH): Promise<ArmoryDrainSummary> {
    const summary: ArmoryDrainSummary = {
      imported: 0,
      failed: 0,
      skipped_stale: 0,
      waiting_blob: 0,
      busy: 0,
    };
    for (const c of await this.repo.listCandidates(limit)) {
      summary[await this.importOne(c)] += 1;
    }
    return summary;
  }

  /**
   * Import one snapshot. An unexpected error rolls its transaction back and
   * marks it `failed` with `internal:<err.name>` — no retry (FLAG Q9) — in a
   * separate statement, never a retry inside the poisoned transaction.
   */
  async importOne(c: ArmoryCandidate): Promise<ArmoryImportOutcome> {
    try {
      return await this.repo.db.transaction((tx) => this.importIn(tx, c));
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'unknown';
      this.logger.error(
        `valheim-armory import failed snapshot=${c.id} (${name})`,
      );
      const marked = await this.repo.markStatus(
        this.repo.db,
        c,
        'failed',
        `internal:${name}`,
      );
      return marked ? 'failed' : 'busy';
    }
  }

  private async importIn(
    tx: ValheimLinkTx,
    c: ArmoryCandidate,
  ): Promise<ArmoryImportOutcome> {
    const snap = await this.repo.lockSnapshot(tx, c);
    if (!snap) return 'busy';
    const checked = validateSnapshotPayload(snap);
    const applied: Applied = checked.ok
      ? await this.apply(tx, snap, checked.message)
      : { status: 'failed', detail: checked.detail };
    const marked = await this.repo.markStatus(
      tx,
      c,
      applied.status,
      applied.detail,
    );
    return marked ? applied.status : 'busy';
  }

  private apply(
    tx: ValheimLinkTx,
    snap: ArmorySnapshot,
    msg: ValheimLinkMessage,
  ): Promise<Applied> {
    if (msg.kind === 'character') return this.applyCharacter(tx, snap, msg);
    if (msg.kind === 'map') return this.applyMap(tx, snap, msg);
    if (msg.kind === 'items') return this.applyItems(tx, snap, msg);
    // ROK-1854 L2 replaces this with the recipes importer.
    return Promise.resolve(UNSUPPORTED_RECIPES);
  }

  private async applyCharacter(
    tx: ValheimLinkTx,
    snap: ArmorySnapshot,
    msg: Extract<ValheimLinkMessage, { kind: 'character' }>,
  ): Promise<Applied> {
    const { values, truncated } = toProfileValues(snap, msg);
    const profile = await this.repo.upsertProfile(tx, values);
    if (!profile) return STALE;
    await this.repo.backfillMapProfile(tx, profile);
    await this.hook.onProfileUpserted(tx, profile);
    const detail = truncated.length ? `truncated:${truncated.join(',')}` : null;
    return { status: 'imported', detail };
  }

  /** Map rows are stored even before the base-map PNG lands (`waiting_blob`). */
  private async applyMap(
    tx: ValheimLinkTx,
    snap: ArmorySnapshot,
    msg: Extract<ValheimLinkMessage, { kind: 'map' }>,
  ): Promise<Applied> {
    const profileId = await this.repo.findProfileId(tx, {
      pelicanServerId: snap.pelicanServerId,
      steamId: msg.character.steamId,
      playerId: msg.character.playerId,
    });
    if (!(await this.repo.upsertMap(tx, toMapValues(snap, msg, profileId)))) {
      return STALE;
    }
    const sha = msg.baseMap?.sha256;
    if (sha && !(await this.repo.blobExists(tx, snap.pelicanServerId, sha))) {
      return { status: 'waiting_blob', detail: 'blob:baseMap' };
    }
    return IMPORTED;
  }

  private async applyItems(
    tx: ValheimLinkTx,
    snap: ArmorySnapshot,
    msg: Extract<ValheimLinkMessage, { kind: 'items' }>,
  ): Promise<Applied> {
    const ok = await this.repo.upsertCatalog(tx, toCatalogValues(snap, msg));
    return ok ? IMPORTED : STALE;
  }
}

const IMPORTED: Applied = { status: 'imported', detail: null };
const STALE: Applied = { status: 'skipped_stale', detail: null };
const UNSUPPORTED_RECIPES: Applied = {
  status: 'failed',
  detail: 'unsupported:recipes',
};
