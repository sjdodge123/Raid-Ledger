import { z } from "zod";
import {
  HubFactFreshnessSchema,
  HubFactSourceSchema,
} from "./hub-facts.schema.js";

/**
 * ROK-1906 (epic ROK-1905) — `GET /plugins/wow/guilds/:id/roster-insights`:
 * the WoW: Forever guild widgets (class, level, role, professions). Arrays are
 * capped at the 2000-row roster bound. Members-only sections (professions) are
 * OMITTED for visitors, never sent empty.
 */
const MAX_ROSTER = 2000;
const characterId = z.number().int().positive();
const level = z.number().int().min(0).max(100);

const RoleCountsSchema = z
  .object({
    tank: z.number().int().nonnegative(),
    healer: z.number().int().nonnegative(),
    dps: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  })
  .strict();

export const WowRosterClassSchema = z
  .object({
    class: z.string().max(40),
    count: z.number().int().nonnegative(),
    members: z
      .array(
        z
          .object({
            name: z.string().max(64),
            characterId: characterId.nullable(),
            level: level.nullable(),
          })
          .strict(),
      )
      .max(MAX_ROSTER),
  })
  .strict();

export const WowRosterLevelsSchema = z
  .object({
    buckets: z
      .array(
        z
          .object({
            from: level,
            to: level,
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20),
    max: level.nullable(),
    median: z.number().min(0).max(100).nullable(),
    atCap: z.number().int().nonnegative(),
  })
  .strict();

export const WowRosterProfessionSchema = z
  .object({
    name: z.string().max(64),
    members: z
      .array(
        z
          .object({
            characterId,
            name: z.string().max(64),
            skill: z.number().int().nonnegative().nullable(),
            maxSkill: z.number().int().nonnegative().nullable(),
            source: HubFactSourceSchema,
          })
          .strict(),
      )
      .max(MAX_ROSTER),
  })
  .strict();

export const WowRosterInsightsSchema = z
  .object({
    classes: z.array(WowRosterClassSchema).max(40),
    levels: WowRosterLevelsSchema,
    roles: z
      .object({ dungeon: RoleCountsSchema, raid: RoleCountsSchema })
      .strict(),
    /** Members and staff only; absent for visitors. */
    professions: z.array(WowRosterProfessionSchema).max(40).optional(),
    freshness: z
      .object({
        roster: HubFactFreshnessSchema.nullable(),
        characters: z
          .object({
            addon: z.number().int().nonnegative(),
            blizzard: z.number().int().nonnegative(),
            none: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type WowRosterInsightsDto = z.infer<typeof WowRosterInsightsSchema>;
