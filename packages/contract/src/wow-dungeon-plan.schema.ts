import { z } from "zod";
import { EventQuestReadinessSchema } from "./wow-event-quest-readiness.schema.js";

/**
 * ROK-2214 (epic ROK-2207) — `GET /plugins/wow/guilds/:id/dungeon-plan`:
 * quest readiness for up to five claimed guild characters and ONE WoW: Forever
 * dungeon, filtered to the guild's faction (neutral quests kept). Stateless:
 * the plan is the query string, nothing is stored.
 */

/** Most characters one plan can hold (a dungeon group). */
export const MAX_DUNGEON_PLAN_CHARACTERS = 5;

/** A character's level against the dungeon's range (bounds inclusive). */
export const DungeonLevelFitSchema = z.enum(["in", "below", "above", "unknown"]);
export type DungeonLevelFit = z.infer<typeof DungeonLevelFitSchema>;

/** `characterIds` arrives as one comma-separated query value; absent/empty → []. */
function splitIdList(value: unknown): unknown {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") return value;
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export const DungeonPlanQuerySchema = z
  .object({
    instanceId: z.coerce.number().int().positive(),
    characterIds: z.preprocess(
      splitIdList,
      z.array(z.string().uuid()).max(MAX_DUNGEON_PLAN_CHARACTERS),
    ),
  })
  .strict();
export type DungeonPlanQuery = z.infer<typeof DungeonPlanQuerySchema>;

export const DungeonPlanCharacterSchema = z
  .object({
    characterId: z.string().uuid(),
    name: z.string().max(64),
    class: z.string().max(50).nullable(),
    level: z.number().int().min(1).max(100).nullable(),
    levelFit: DungeonLevelFitSchema,
  })
  .strict();
export type DungeonPlanCharacterDto = z.infer<typeof DungeonPlanCharacterSchema>;

export const DungeonPlanSchema = z
  .object({
    instance: z
      .object({
        id: z.number().int().positive(),
        name: z.string().max(120),
        minimumLevel: z.number().int(),
        maximumLevel: z.number().int(),
      })
      .strict(),
    /** The side the quest list is filtered to; null = no filter applied. */
    side: z.enum(["alliance", "horde"]).nullable(),
    /** `guild` = the guild's faction column; `characters` = their shared side. */
    sideSource: z.enum(["guild", "characters"]).nullable(),
    /** Distinct dungeon quests removed because only the other faction can take them. */
    hiddenOtherFaction: z.number().int().min(0),
    /** Kept characters, in request order. */
    characters: z.array(DungeonPlanCharacterSchema).max(MAX_DUNGEON_PLAN_CHARACTERS),
    /** Requested ids not claimed on this guild's roster; nothing else about them is returned. */
    droppedCharacterIds: z.array(z.string().uuid()).max(MAX_DUNGEON_PLAN_CHARACTERS),
    /** Same shape as the event readiness read; `quests` is the faction-filtered set. */
    readiness: EventQuestReadinessSchema,
  })
  .strict();
export type DungeonPlanDto = z.infer<typeof DungeonPlanSchema>;
