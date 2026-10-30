/**
 * ROK-1915 — the optional `withGear: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: LedgerLink gear on the three
 * linked level-60 mains, for the "Gear readiness" hub widget:
 *   - Aldren (gm): schema 2, avg ilvl 63, every enchantable slot enchanted;
 *   - Brisa (officer): schema 2, avg ilvl 50 (below the 55 floor), Feet (8)
 *     and Wrist (9) equipped without an enchant;
 *   - Dainel (member): schema 1, avg ilvl 58 — enchants "unknown".
 *
 * The gear rides in the SAME `char` snapshot row as the lockouts
 * (`demo-test-guild-lockouts.helpers.ts`): the row is unique on
 * `(character, section)`, so a second upsert would clobber them.
 */
import {
  ADDON_CHAR_SNAPSHOT_SCHEMA,
  type AddonSnapshotGearItem,
} from '@raid-ledger/contract';
import type { SeedLockoutOwner } from './demo-test-guild-lockouts.helpers';

/** One owner's gear and the snapshot schema it was "exported" with. */
export interface SeedGear {
  gear: AddonSnapshotGearItem[];
  schema: number;
}

interface SeededGearChar {
  characterId: string;
  name: string;
}

/** What the `withGear` seed wrote — what the widget should show. */
export interface SeededGuildGear {
  enchanted: SeededGearChar & { ilvl: number };
  belowFloor: SeededGearChar & { ilvl: number };
  missingEnchants: SeededGearChar & { slots: number[] };
  unknown: SeededGearChar;
}

const ENCHANT = 1891;

function items(
  slots: readonly number[],
  ilvl: number,
  enchanted: readonly number[],
): AddonSnapshotGearItem[] {
  return slots.map((slot) => ({
    slot,
    itemId: 16800 + slot,
    ilvl,
    bonusIds: [],
    ...(enchanted.includes(slot) ? { enchantId: ENCHANT } : {}),
  }));
}

const ENCHANTABLE = [5, 8, 9, 10, 15, 16];

/** Each linked owner's gear. */
export function seedGearFor(owner: SeedLockoutOwner): SeedGear {
  const schema = ADDON_CHAR_SNAPSHOT_SCHEMA;
  if (owner === 'gm')
    return { gear: items([1, 3, 7, ...ENCHANTABLE], 63, ENCHANTABLE), schema };
  if (owner === 'officer')
    return { gear: items([1, 7, ...ENCHANTABLE], 50, [5, 10, 15, 16]), schema };
  return { gear: items([1, 5, 8, 9, 16], 58, []), schema: 1 };
}

/** The seeded characters' expected gear readiness, for the response. */
export function seededGear(
  ids: Record<SeedLockoutOwner, string>,
): SeededGuildGear {
  return {
    enchanted: { characterId: ids.gm, name: 'Aldren', ilvl: 63 },
    belowFloor: { characterId: ids.officer, name: 'Brisa', ilvl: 50 },
    missingEnchants: {
      characterId: ids.officer,
      name: 'Brisa',
      slots: [8, 9],
    },
    unknown: { characterId: ids.member, name: 'Dainel' },
  };
}
