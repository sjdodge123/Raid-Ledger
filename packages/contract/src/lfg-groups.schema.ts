import { z } from 'zod';

// ============================================================
// LFG groups (ROK-2352) — one game can hold several LFG groups
// ============================================================
//
// A group is `(gameId, groupKey)`. Core treats the key as OPAQUE: only an
// active `lfg-grouping` plugin adapter mints or reads a non-empty key (WoW:
// `dungeon:<instanceId>` / `raid:<instanceId>`, a `:<difficulty>` suffix is
// reserved). `''` is the whole-game group — every non-WoW game, WoW with the
// plugin off, and WoW's "Any dungeon" group.
// Leaf module: imports nothing from `lfg.schema.ts`, which imports from here.
// Not part of the LedgerLink wire format (`ledgerlink/v1/`).

/** The whole-game group's key. Never null — NULLs never collide in unique indexes. */
export const LFG_ANY_GROUP_KEY = '' as const;

/** Mirrors the `lfg_intents.group_key` CHECK (`''` OR this pattern). */
export const LFG_GROUP_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9:_-]{1,64}$/;

/** `DELETE /lfg/:gameId?group=*` — every one of the caller's hands in the game. */
export const LFG_ALL_GROUPS_KEY = '*' as const;

/** A group key: `''` or `<namespace>:<payload>` (see {@link LFG_GROUP_KEY_PATTERN}). */
export const LfgGroupKeySchema = z.union([
  z.literal(LFG_ANY_GROUP_KEY),
  z.string().regex(LFG_GROUP_KEY_PATTERN, 'Invalid LFG group key'),
]);
export type LfgGroupKey = z.infer<typeof LfgGroupKeySchema>;

/** `?group=<key>` on detail/overlap/history/suggestions/invites/convert/start-now. */
export const LfgGroupQuerySchema = z.object({
  group: LfgGroupKeySchema.default(LFG_ANY_GROUP_KEY),
});
export type LfgGroupQuery = z.infer<typeof LfgGroupQuerySchema>;

/** `DELETE /lfg/:gameId?group=` — also accepts `*` (all my hands in the game). */
export const LfgDeleteGroupQuerySchema = z.object({
  group: z
    .union([z.literal(LFG_ALL_GROUPS_KEY), LfgGroupKeySchema])
    .default(LFG_ANY_GROUP_KEY),
});
export type LfgDeleteGroupQuery = z.infer<typeof LfgDeleteGroupQuerySchema>;

/** `GET /lfg/:gameId/groups?include=catalogue` adds empty catalogue groups (picker). */
export const LfgGroupListQuerySchema = z.object({
  include: z.literal('catalogue').optional(),
});
export type LfgGroupListQuery = z.infer<typeof LfgGroupListQuerySchema>;

/** A pointer to one group of the same game (e.g. the caller's other hands). */
export const LfgGroupRefSchema = z.object({
  groupKey: LfgGroupKeySchema,
  /** Adapter label ("Deadmines"); null for the whole-game group. */
  groupLabel: z.string().nullable(),
});
export type LfgGroupRefDto = z.infer<typeof LfgGroupRefSchema>;

/** What a group stands for. `any` = the whole-game (`''`) group. */
export const LfgGroupKindSchema = z.enum(['dungeon', 'raid', 'any']);
export type LfgGroupKind = z.infer<typeof LfgGroupKindSchema>;

/** Tank / healer / dps counts — a roster shape or how much of it is covered. */
export const LfgRoleCountsSchema = z.object({
  tank: z.number().int().nonnegative(),
  healer: z.number().int().nonnegative(),
  dps: z.number().int().nonnegative(),
});
export type LfgRoleCounts = z.infer<typeof LfgRoleCountsSchema>;
