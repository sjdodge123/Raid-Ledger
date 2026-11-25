import { z } from 'zod';
import { LfgGroupSummarySchema } from './lfg.schema.js';
import { LfgGroupKindSchema, LfgRoleCountsSchema } from './lfg-groups.schema.js';

/**
 * ROK-2352 — `GET /lfg/:gameId/groups`. Kept out of `lfg-groups.schema.ts`
 * because it extends `LfgGroupSummarySchema`, and `lfg.schema.ts` imports the
 * key grammar from `lfg-groups.schema.ts` (an import cycle would leave one
 * side undefined at module init).
 */

/** One group of a game: the summary plus what the grouping adapter knows. */
export const LfgGroupListItemSchema = LfgGroupSummarySchema.extend({
  kind: LfgGroupKindSchema.optional(),
  /** The roster the group fills at lock-in (WoW: `wowRosterShapeForSize`). */
  rosterShape: LfgRoleCountsSchema.optional(),
  /** Instance size (players). */
  size: z.number().int().positive().optional(),
  levelRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** How much of `rosterShape` distinct live members can fill. */
  coverage: LfgRoleCountsSchema.optional(),
});
export type LfgGroupListItemDto = z.infer<typeof LfgGroupListItemSchema>;

/** The groups of one game, the whole-game ("Any") group first. */
export const LfgGroupListResponseSchema = z.object({
  gameId: z.number(),
  groups: z.array(LfgGroupListItemSchema),
});
export type LfgGroupListResponseDto = z.infer<typeof LfgGroupListResponseSchema>;
