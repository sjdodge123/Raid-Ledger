/**
 * ROK-1727: read-path resolver for WoW: Forever gear. Builds the displayed
 * `CharacterEquipmentDto` from the character's LedgerLink `char` snapshot
 * (the source of truth, R1) plus cached Wowhead item metadata.
 *
 * Read-only on `characters`: never writes `equipment` or `last_synced_at`.
 * Unknown/due item ids are enqueued fire-and-forget (D6 — the only path that
 * resolves snapshots imported before the resolver shipped).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterEquipmentDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { DisplayEquipmentRow } from '../plugin-host/extension-points';
import { addonSnapshotToEquipment } from './addon-equipment.adapter';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import {
  loadForeverCharSnapshot,
  type ForeverCharSnapshot,
} from './forever-char-snapshot.query';

const FOREVER_VARIANT = 'wow_forever';

type CharSnapshot = ForeverCharSnapshot;

/** Gear item ids in a snapshot (entries without an itemId are skipped). */
export function snapshotItemIds(snapshot: CharSnapshot): number[] {
  const ids = (snapshot.data.gear ?? []).flatMap((g) =>
    typeof g.itemId === 'number' ? [g.itemId] : [],
  );
  return [...new Set(ids)];
}

/** Newest wins (Q4): an Armory sync at/after the capture keeps the Armory. */
export function armoryIsNewer(
  equipment: CharacterEquipmentDto | null,
  capturedAt: Date,
): boolean {
  if (!equipment?.syncedAt) return false;
  const armory = Date.parse(equipment.syncedAt);
  return Number.isFinite(armory) && armory >= capturedAt.getTime();
}

@Injectable()
export class ForeverDisplayEquipmentService {
  private readonly logger = new Logger(ForeverDisplayEquipmentService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly itemMeta: WowItemMetaService,
  ) {}

  /** @returns the addon equipment, or undefined for "no opinion". */
  async resolve(
    row: DisplayEquipmentRow,
  ): Promise<CharacterEquipmentDto | undefined> {
    if (row.gameVariant && row.gameVariant !== FOREVER_VARIANT) return;
    const snapshot = await loadForeverCharSnapshot(this.db, row.id);
    if (!snapshot || armoryIsNewer(row.equipment, snapshot.capturedAt)) {
      return undefined;
    }
    const ids = snapshotItemIds(snapshot);
    const meta = await this.itemMeta.getMeta(ids);
    this.enqueueInBackground(
      ids.filter((id) => !meta.has(id) || isDue(meta.get(id))),
    );
    return addonSnapshotToEquipment(snapshot, meta);
  }

  /** Fire-and-forget: never blocks or fails the read. */
  private enqueueInBackground(ids: number[]): void {
    if (ids.length === 0) return;
    // `enqueue` checks the kill switch itself.
    this.itemMeta.enqueue(ids).catch((err: unknown) => {
      this.logger.warn(`Wowhead enqueue failed: ${String(err)}`);
    });
  }
}

function isDue(row: { nextRetryAt: Date | null } | undefined): boolean {
  return !!row?.nextRetryAt && row.nextRetryAt.getTime() <= Date.now();
}
