/**
 * ROK-2176 §4.5: read-time decoration of a WoW character's displayed gear
 * (Armory or LedgerLink addon) with the parsed Wowhead tooltip stored in
 * `wow_item_meta`. One `getMeta` per read; due ids are enqueued
 * fire-and-forget (same as ForeverDisplayEquipmentService).
 *
 * Best-effort and read-only: any failure returns the equipment undecorated,
 * and it never writes `characters.equipment` — it returns a copy.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  CharacterEquipmentDto,
  EquipmentItemDto,
} from '@raid-ledger/contract';
import type { DisplayEquipmentRow } from '../plugin-host/extension-points';
import { WowItemMetaService } from './wowhead-item/wow-item-meta.service';
import { isMetaDue } from './wowhead-item/wow-item-meta.due';
import type { WowItemMetaRow } from './wowhead-item/wowhead-item.types';

/** Distinct item ids of the equipped items (malformed `items` → none). */
export function equipmentItemIds(equipment: CharacterEquipmentDto): number[] {
  const items: unknown = equipment.items;
  if (!Array.isArray(items)) return [];
  return [...new Set(equipment.items.map((item) => item.itemId))];
}

/** The item with the row's stored tooltip attached, if the row has one. */
function withTooltip(
  item: EquipmentItemDto,
  row: WowItemMetaRow | undefined,
): EquipmentItemDto {
  return row?.tooltip ? { ...item, tooltip: row.tooltip } : item;
}

@Injectable()
export class WowDisplayTooltipService {
  private readonly logger = new Logger(WowDisplayTooltipService.name);

  constructor(private readonly itemMeta: WowItemMetaService) {}

  /**
   * A copy of `equipment` with stored tooltips attached; never throws.
   * `enqueueDue: false` skips the background enqueue — for addon gear, whose
   * due ids `ForeverDisplayEquipmentService.resolve` already enqueued on the
   * same read (one enqueue per id per read).
   */
  async decorate(
    row: Pick<DisplayEquipmentRow, 'id'>,
    equipment: CharacterEquipmentDto,
    opts: { enqueueDue?: boolean } = {},
  ): Promise<CharacterEquipmentDto> {
    try {
      const ids = equipmentItemIds(equipment);
      if (ids.length === 0) return equipment;
      const meta = await this.itemMeta.getMeta(ids);
      const now = Date.now();
      if (opts.enqueueDue !== false) {
        this.enqueueInBackground(
          ids.filter((id) => isMetaDue(meta.get(id), now)),
        );
      }
      const items = equipment.items.map((item) =>
        withTooltip(item, meta.get(item.itemId)),
      );
      return { ...equipment, items };
    } catch (err: unknown) {
      this.logger.warn(
        `Tooltips for character ${row.id} failed: ${String(err)}`,
      );
      return equipment;
    }
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
