/**
 * ROK-1727: read-path resolver for WoW: Forever gear. Builds the displayed
 * `CharacterEquipmentDto` from the character's LedgerLink `char` snapshot
 * plus cached Wowhead item metadata.
 * ROK-2138 D8: the stored Armory (Blizzard) gear is primary — the addon gear
 * only fills the gap when the Armory has no equipment (absent or zero items),
 * whatever the dates.
 *
 * Read-only on `characters`: never writes `equipment` or `last_synced_at`.
 * Unknown/due item ids are enqueued fire-and-forget (D6 — the only path that
 * resolves snapshots imported before the resolver shipped). ROK-1760: an
 * `error` row is due again on view after a short floor (`isMetaDue`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterEquipmentDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { DisplayEquipmentRow } from '../plugin-host/extension-points';
import { addonSnapshotToEquipment } from './addon-equipment.adapter';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import { isMetaDue } from './wowhead-item/wow-item-meta.due';
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

/** D8: stored Armory equipment with at least one item keeps the Armory. */
export function armoryHasEquipment(
  equipment: CharacterEquipmentDto | null,
): boolean {
  const items: unknown = equipment?.items;
  return Array.isArray(items) && items.length > 0;
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
    if (armoryHasEquipment(row.equipment)) return undefined;
    const snapshot = await loadForeverCharSnapshot(this.db, row.id);
    if (!snapshot) return undefined;
    const ids = snapshotItemIds(snapshot);
    const meta = await this.itemMeta.getMeta(ids);
    const now = Date.now();
    this.enqueueInBackground(ids.filter((id) => isMetaDue(meta.get(id), now)));
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
