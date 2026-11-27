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

/**
 * ROK-2352 §3.2 — one of the viewer's hands in this game that was cleared
 * because another of their groups locked in / started ("Your hand for
 * <fromLabel> was withdrawn because you're in <toLabel> now"). Shown once:
 * `POST /lfg/hands/notices/ack` hides it. Labels are the grouping adapter's
 * instance names; null for the whole-game (`''`) group or when the game's
 * grouping plugin is off.
 */
export const LfgClearedHandNoticeSchema = z.object({
  intentId: z.number().int().positive(),
  fromGroupKey: z.string(),
  fromLabel: z.string().nullable(),
  toGroupKey: z.string(),
  toLabel: z.string().nullable(),
});
export type LfgClearedHandNoticeDto = z.infer<typeof LfgClearedHandNoticeSchema>;

/** `POST /lfg/hands/notices/ack` body — the notices the viewer has seen. */
export const LfgAckHandNoticesSchema = z.object({
  intentIds: z.array(z.number().int().positive()).min(1).max(50),
});
export type LfgAckHandNoticesDto = z.infer<typeof LfgAckHandNoticesSchema>;

/** The groups of one game, the whole-game ("Any") group first. */
export const LfgGroupListResponseSchema = z.object({
  gameId: z.number(),
  groups: z.array(LfgGroupListItemSchema),
  /** ROK-2352 §3.2 (additive): unseen notices; omitted when there are none. */
  notices: z.array(LfgClearedHandNoticeSchema).optional(),
});
export type LfgGroupListResponseDto = z.infer<typeof LfgGroupListResponseSchema>;
