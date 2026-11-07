/**
 * ROK-1920 — map the Armory equipment a Blizzard sync stored on a
 * `characters` row (contract `CharacterEquipmentSchema`, string slot types)
 * to the fact layer's gear shape (`AddonSnapshotGearItem`, inventory slot
 * ids 1-19).
 */
import {
  CharacterEquipmentSchema,
  type AddonSnapshotGearItem,
  type EquipmentItemDto,
} from '@raid-ledger/contract';
import { ADDON_SLOT_NAMES } from '../addon-equipment.adapter';

/** Longest gear name the gear fact schema accepts. */
const MAX_NAME = 128;

/** Blizzard slot type (`HEAD`, `MAIN_HAND`, …) → inventory slot id 1-19. */
const SLOT_IDS: ReadonlyMap<string, number> = new Map(
  Object.entries(ADDON_SLOT_NAMES).map(([id, name]) => [name, Number(id)]),
);

/**
 * Inventory slot id of a Blizzard slot type.
 * @returns null for a slot type outside the 19 equipment slots.
 */
export function blizzardSlotId(slotType: string): number | null {
  return SLOT_IDS.get(slotType) ?? null;
}

/** The first reported enchantment id of an item, if any. */
function firstEnchantId(item: EquipmentItemDto): number | undefined {
  return item.enchantments?.find((e) => e.enchantmentId !== undefined)
    ?.enchantmentId;
}

/**
 * One stored Armory item as a gear fact item; null when its slot is unknown.
 * `bonusIds` is always empty (the Armory equipment has none to report).
 */
export function toGearItem(
  item: EquipmentItemDto,
): AddonSnapshotGearItem | null {
  const slot = blizzardSlotId(item.slot);
  if (slot === null) return null;
  const enchantId = firstEnchantId(item);
  const name = item.name.slice(0, MAX_NAME);
  return {
    slot,
    itemId: item.itemId,
    ilvl: item.itemLevel,
    bonusIds: [],
    ...(enchantId !== undefined ? { enchantId } : {}),
    ...(name ? { name } : {}),
  };
}

/**
 * The gear of a stored `characters.equipment` jsonb, when it is Armory data.
 * @returns null when the value does not parse, came from a LedgerLink import
 *   (`source: 'addon'` — that is not Blizzard data), or has no mappable item.
 */
export function armoryGear(raw: unknown): AddonSnapshotGearItem[] | null {
  const parsed = CharacterEquipmentSchema.safeParse(raw);
  if (!parsed.success || parsed.data.source === 'addon') return null;
  const gear = parsed.data.items.flatMap((item) => {
    const g = toGearItem(item);
    return g ? [g] : [];
  });
  return gear.length > 0 ? gear : null;
}

/**
 * When the stored Armory equipment was itself fetched (its `syncedAt`).
 * A sync whose equipment call fails keeps the prior gear but still bumps
 * `lastSyncedAt`, so gear facts must be dated from this (ROK-2130).
 * @returns null when the value does not parse.
 */
export function armoryGearSyncedAt(raw: unknown): Date | null {
  const parsed = CharacterEquipmentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const at = new Date(parsed.data.syncedAt);
  return Number.isNaN(at.getTime()) ? null : at;
}
