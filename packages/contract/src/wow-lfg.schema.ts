import { z } from 'zod';
import type { LfgRoleCounts } from './lfg-groups.schema.js';

// ============================================================
// WoW instance LFG (ROK-2352) — blizzard plugin's `lfg-grouping` detail
// ============================================================
// Stored in `wow_lfg_hand_details`; core never reads it. Not LedgerLink.

/** A WoW group role. Mirrors the `wow_lfg_hand_details.roles` CHECK. */
export const WowLfgRoleSchema = z.enum(['tank', 'healer', 'dps']);
export type WowLfgRole = z.infer<typeof WowLfgRoleSchema>;

const distinct = (roles: readonly string[]): boolean => new Set(roles).size === roles.length;

/** `handDetail` on a WoW instance hand: 1–3 distinct roles, optional own character. */
export const WowLfgHandDetailSchema = z
  .object({
    roles: z.array(WowLfgRoleSchema).min(1).max(3).refine(distinct, 'Roles must be distinct'),
    /** One of the caller's characters on this game; null/absent = none picked. */
    characterId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type WowLfgHandDetailDto = z.infer<typeof WowLfgHandDetailSchema>;

/** One member's detail in a group view. Empty `roles` = "role not set" (Discord hand). */
export const WowLfgMemberDetailSchema = z.object({
  intentId: z.number().int().positive(),
  roles: z.array(WowLfgRoleSchema).max(3),
  characterId: z.string().uuid().nullable(),
  characterName: z.string().nullable(),
  characterClass: z.string().nullable(),
});
export type WowLfgMemberDetailDto = z.infer<typeof WowLfgMemberDetailSchema>;

/** Category default size when an instance has no `maxPlayers`. */
export const WOW_LFG_DEFAULT_SIZE = { dungeon: 5, raid: 10 } as const;

const FIXED_SHAPES: Readonly<Record<number, LfgRoleCounts>> = {
  10: { tank: 2, healer: 3, dps: 5 },
  20: { tank: 2, healer: 4, dps: 14 },
  25: { tank: 2, healer: 6, dps: 17 },
  40: { tank: 4, healer: 10, dps: 26 },
};

/**
 * The tank/healer/dps roster for a WoW instance of `size` players (spec §3.4):
 * ≤5 → 1/1/3; 10/20/25/40 fixed; any other size → tank ≈ size/10 and healer
 * ≈ size/5 (each min 1), the rest dps. A missing or non-positive size falls
 * back to the category default (dungeon 5, raid 10).
 */
export function wowRosterShapeForSize(
  size: number | null | undefined,
  category: 'dungeon' | 'raid' = 'dungeon',
): LfgRoleCounts {
  const n =
    size != null && Number.isInteger(size) && size > 0 ? size : WOW_LFG_DEFAULT_SIZE[category];
  if (n <= 5) return { tank: 1, healer: 1, dps: 3 };
  const fixed = FIXED_SHAPES[n];
  if (fixed) return { ...fixed };
  const tank = Math.max(1, Math.round(n / 10));
  const healer = Math.max(1, Math.round(n / 5));
  return { tank, healer, dps: n - tank - healer };
}
