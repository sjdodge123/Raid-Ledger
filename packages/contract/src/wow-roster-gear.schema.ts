import { z } from "zod";
import { HubFactFreshnessSchema } from "./hub-facts.schema.js";

/**
 * ROK-1915 (W7 + W8) — the members-only "Gear readiness" section of
 * `GET /plugins/wow/guilds/:id/roster-insights`: average item level across the
 * guild's linked level-60 mains, and which of them are missing enchants.
 * Only schema-2 addon snapshots carry `enchantId`; older ones count as unknown.
 */

/** Inventory slots checked for enchants: chest, feet, wrist, hands, back, main hand. */
export const FOREVER_ENCHANTABLE_SLOTS = [5, 8, 9, 10, 15, 16] as const;

/**
 * Item-level floor per level bracket (v1 constant; a leader-set floor is
 * deferred). `floor = bracket start − 5`, and 55 at the level cap. Ordered
 * highest bracket first. ROK-1926 reuses it.
 */
export const FOREVER_ILVL_FLOOR_BY_BRACKET = [
  { minLevel: 60, floor: 55 },
  { minLevel: 50, floor: 45 },
  { minLevel: 40, floor: 35 },
  { minLevel: 30, floor: 25 },
  { minLevel: 20, floor: 15 },
  { minLevel: 10, floor: 5 },
  { minLevel: 0, floor: 0 },
] as const;

/** The item-level floor for a character of `level` (0 below level 10). */
export function foreverIlvlFloor(level: number): number {
  const bracket = FOREVER_ILVL_FLOOR_BY_BRACKET.find(
    (b) => level >= b.minLevel,
  );
  return bracket?.floor ?? 0;
}

/** WoW inventory slot ids (1-19) → display names. */
export const FOREVER_GEAR_SLOT_NAMES: Readonly<Record<number, string>> = {
  1: "Head",
  2: "Neck",
  3: "Shoulder",
  4: "Shirt",
  5: "Chest",
  6: "Waist",
  7: "Legs",
  8: "Feet",
  9: "Wrist",
  10: "Hands",
  11: "Finger",
  12: "Finger",
  13: "Trinket",
  14: "Trinket",
  15: "Back",
  16: "Main hand",
  17: "Off hand",
  18: "Ranged",
  19: "Tabard",
};

/** Display name for an inventory slot id, `Slot N` when unknown. */
export function foreverGearSlotName(slot: number): string {
  return FOREVER_GEAR_SLOT_NAMES[slot] ?? `Slot ${slot}`;
}

export const MAX_GEAR_BUCKETS = 8;
export const MAX_GEAR_BELOW = 10;
export const MAX_GEAR_MISSING = 25;

const count = z.number().int().nonnegative();
const ilvl = z.number().int().nonnegative();
/** `characters.id` is a uuid. */
const characterId = z.string().uuid();

const GearBucketSchema = z
  .object({ from: ilvl, to: ilvl, count })
  .strict();

const GearBelowSchema = z
  .object({ name: z.string(), characterId, ilvl })
  .strict();

const GearMissingSchema = z
  .object({
    name: z.string(),
    characterId,
    slots: z.array(z.number().int().min(1).max(19)).max(19),
  })
  .strict();

export const WowRosterGearSchema = z
  .object({
    ilvl: z
      .object({
        buckets: z.array(GearBucketSchema).max(MAX_GEAR_BUCKETS),
        median: ilvl.nullable(),
        floor: ilvl,
        belowCount: count,
        below: z.array(GearBelowSchema).max(MAX_GEAR_BELOW),
        reporters: count,
        levelling: count,
      })
      .strict(),
    enchants: z
      .object({
        checked: count,
        unknown: count,
        missingCount: count,
        missing: z.array(GearMissingSchema).max(MAX_GEAR_MISSING),
      })
      .strict(),
    freshness: HubFactFreshnessSchema.nullable(),
  })
  .strict();
export type WowRosterGearDto = z.infer<typeof WowRosterGearSchema>;
