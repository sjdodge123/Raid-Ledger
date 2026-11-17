import { z } from "zod";

/**
 * ROK-2212 (epic ROK-2207 phase 2) — `GET /plugins/wow/guilds/:id/suggested-groups`:
 * groups of five (1 tank / 1 healer / 3 dps) drawn from every known character
 * of a WoW: Forever guild (claimed characters AND unclaimed roster rows, one
 * character per player) whose levels all fit a listed dungeon's range.
 */

/** Players in one 5-player dungeon group. */
export const SUGGESTED_GROUP_SIZE = 5;
/** Lineups kept per dungeon (ruling 7, the planner-tab section). */
export const MAX_SUGGESTED_GROUPS_PER_DUNGEON = 10;
/** Groups on the hub widget: the best of each of 3 distinct dungeons (ruling 3). */
export const SUGGESTED_GROUPS_TOP_COUNT = 3;

export const SuggestedGroupsQuerySchema = z
  .object({
    scope: z.enum(["top", "all"]).default("top"),
    instanceId: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type SuggestedGroupsQuery = z.infer<typeof SuggestedGroupsQuerySchema>;

export const SuggestedGroupRoleSchema = z.enum(["tank", "healer", "dps"]);
export type SuggestedGroupRole = z.infer<typeof SuggestedGroupRoleSchema>;

/**
 * One member of a group. `key` is the dungeon planner's token text: the
 * character uuid for a claimed character, `m<memberId>` for an unclaimed
 * roster row — so the same value builds the planner link.
 */
export const SuggestedGroupMemberSchema = z
  .object({
    key: z.string().max(40),
    /** Null = an unclaimed roster row. */
    characterId: z.string().uuid().nullable(),
    /** `guild_members.id`; null only when the row has none (then it is claimed). */
    memberId: z.number().int().positive().nullable(),
    /** Null = unclaimed, OR the viewer is a visitor (owners are never shown to them). */
    userId: z.number().int().positive().nullable(),
    name: z.string().max(64),
    class: z.string().max(50).nullable(),
    level: z.number().int().min(1).max(100),
    /** The ONE role this member fills in this group. */
    role: SuggestedGroupRoleSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.characterId !== null && m.key !== m.characterId) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "A claimed member's key is its characterId" });
    }
    if (m.characterId === null && (m.memberId === null || m.key !== `m${m.memberId}`)) {
      ctx.addIssue({ code: "custom", path: ["key"], message: "An unclaimed member's key is m<memberId>" });
    }
  });
export type SuggestedGroupMemberDto = z.infer<typeof SuggestedGroupMemberSchema>;

export const SuggestedGroupSchema = z
  .object({
    instance: z
      .object({
        id: z.number().int().positive(),
        name: z.string().max(120),
        minimumLevel: z.number().int(),
        maximumLevel: z.number().int(),
      })
      .strict(),
    /** Order: tank, healer, then the three dps. */
    members: z.array(SuggestedGroupMemberSchema).length(SUGGESTED_GROUP_SIZE),
    /** Highest minus lowest member level. */
    levelSpread: z.number().int().min(0),
    /** Guild-faction dungeon quests ≥3 of the 5 have not done; null = not computed. */
    sharedQuests: z.number().int().min(0).nullable(),
  })
  .strict();
export type SuggestedGroupDto = z.infer<typeof SuggestedGroupSchema>;

/** Who the pool held and who it left out (the widget's footnote). */
export const SuggestedGroupsPoolSchema = z
  .object({
    tank: z.number().int().min(0),
    healer: z.number().int().min(0),
    dps: z.number().int().min(0),
    unclaimed: z.number().int().min(0),
    skippedNoRole: z.number().int().min(0),
    skippedNoLevel: z.number().int().min(0),
  })
  .strict();
export type SuggestedGroupsPoolDto = z.infer<typeof SuggestedGroupsPoolSchema>;

export const SuggestedGroupsSchema = z
  .object({
    groups: z.array(SuggestedGroupSchema).max(400),
    pool: SuggestedGroupsPoolSchema,
    generatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type SuggestedGroupsDto = z.infer<typeof SuggestedGroupsSchema>;
