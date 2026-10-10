/**
 * ROK-1727: pure adapter — LedgerLink `char` snapshot gear (frozen schema 1)
 * + resolved Wowhead item metadata → the `CharacterEquipmentDto` the
 * equipment grid already renders.
 *
 * No I/O: the caller loads the snapshot and the `wow_item_meta` rows.
 */
import type {
  AddonCharSnapshotData,
  AddonSnapshotGearItem,
  CharacterEquipmentDto,
  EquipmentItemDto,
} from '@raid-ledger/contract';

/**
 * The `wow_item_meta` columns this adapter reads. Structurally a subset of
 * the Drizzle row type (`WowItemMetaRow`), so a row map passes as-is.
 */
export interface AddonItemMeta {
  status: string;
  env: number | null;
  name: string | null;
  quality: number | null;
  icon: string | null;
}

export interface AddonGearSnapshot {
  data: Pick<AddonCharSnapshotData, 'gear'>;
  capturedAt: Date;
}

/** WoW inventory slot id (1-19) → Blizzard slot name used by the grid. */
export const ADDON_SLOT_NAMES: Readonly<Record<number, string>> = {
  1: 'HEAD',
  2: 'NECK',
  3: 'SHOULDER',
  4: 'SHIRT',
  5: 'CHEST',
  6: 'WAIST',
  7: 'LEGS',
  8: 'FEET',
  9: 'WRIST',
  10: 'HANDS',
  11: 'FINGER_1',
  12: 'FINGER_2',
  13: 'TRINKET_1',
  14: 'TRINKET_2',
  15: 'BACK',
  16: 'MAIN_HAND',
  17: 'OFF_HAND',
  18: 'RANGED',
  19: 'TABARD',
};

/** Wowhead quality 0-7 → Blizzard quality type. */
const QUALITY_NAMES = [
  'POOR',
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'ARTIFACT',
  'HEIRLOOM',
] as const;

/** Slots left out of the average item level (Blizzard semantics, D4). */
const AVG_EXCLUDED_SLOTS = new Set([4, 19]);

const RESOLVED_STATUSES = new Set(['resolved', 'classic_fallback']);
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/large';

/** A gear entry that occupies a known slot with a real item. */
type EquippedGear = AddonSnapshotGearItem & {
  itemId: number;
  slotName: string;
};

type ResolvedFields = Pick<
  EquipmentItemDto,
  'name' | 'quality' | 'iconUrl' | 'wowheadEnv' | 'resolved'
>;

function isResolved(
  meta: AddonItemMeta | undefined,
): meta is AddonItemMeta & { name: string } {
  return !!meta && RESOLVED_STATUSES.has(meta.status) && !!meta.name;
}

function toWowheadEnv(env: number | null): 16 | 4 {
  return env === 4 ? 4 : 16;
}

function metaFields(
  itemId: number,
  meta: AddonItemMeta | undefined,
): ResolvedFields {
  if (!isResolved(meta)) {
    return { name: `Item #${itemId}`, quality: 'COMMON', resolved: false };
  }
  return {
    name: meta.name,
    quality: QUALITY_NAMES[meta.quality ?? 1] ?? 'COMMON',
    iconUrl: meta.icon ? `${ICON_BASE}/${meta.icon}.jpg` : undefined,
    wowheadEnv: toWowheadEnv(meta.env),
    resolved: true,
  };
}

function toItem(
  gear: EquippedGear,
  meta: Map<number, AddonItemMeta>,
): EquipmentItemDto {
  return {
    slot: gear.slotName,
    itemId: gear.itemId,
    itemLevel: gear.ilvl ?? 0,
    itemSubclass: null,
    ...metaFields(gear.itemId, meta.get(gear.itemId)),
  };
}

/**
 * Keep one gear entry per slot. Duplicate slots should not occur (the addon
 * emits one per inventory slot); if they do, the LAST entry wins, matching
 * how the web's `buildOrderedItems` Map keys items by slot.
 */
function equippedBySlot(
  gear: AddonSnapshotGearItem[],
): Map<number, EquippedGear> {
  const bySlot = new Map<number, EquippedGear>();
  for (const g of gear) {
    const slotName = ADDON_SLOT_NAMES[g.slot];
    if (g.itemId === undefined || !slotName) continue;
    bySlot.set(g.slot, { ...g, itemId: g.itemId, slotName });
  }
  return bySlot;
}

function averageItemLevel(bySlot: Map<number, EquippedGear>): number | null {
  const levels = [...bySlot.values()]
    .filter((g) => !AVG_EXCLUDED_SLOTS.has(g.slot) && g.ilvl !== undefined)
    .map((g) => g.ilvl as number);
  if (levels.length === 0) return null;
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

/** Build the display equipment for a Forever character from its addon snapshot. */
export function addonSnapshotToEquipment(
  snapshot: AddonGearSnapshot,
  meta: Map<number, AddonItemMeta>,
): CharacterEquipmentDto {
  const bySlot = equippedBySlot(snapshot.data.gear);
  const ordered = [...bySlot.entries()].sort(([a], [b]) => a - b);
  return {
    equippedItemLevel: averageItemLevel(bySlot),
    items: ordered.map(([, g]) => toItem(g, meta)),
    syncedAt: snapshot.capturedAt.toISOString(),
    source: 'addon',
  };
}
