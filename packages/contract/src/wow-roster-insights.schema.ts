import { z } from "zod";
import {
  HubFactFreshnessSchema,
  HubFactSourceSchema,
} from "./hub-facts.schema.js";

/**
 * ROK-1906 (epic ROK-1905) — `GET /plugins/wow/guilds/:id/roster-insights`:
 * the WoW: Forever guild widgets (class, level, role, professions). Arrays are
 * capped at the 2000-row roster bound. Members-only sections (professions,
 * lockouts) are OMITTED for visitors, never sent empty.
 */
const MAX_ROSTER = 2000;
/** `characters.id` is a uuid. */
const characterId = z.string().uuid();
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

/**
 * ROK-1914 — one instance save across the roster: every linked character with
 * an unexpired lockout for this `(instanceId, difficultyId)`. `resetAt` is the
 * soonest member reset in the group; each member carries its own.
 */
export const WowRosterLockoutSchema = z
  .object({
    instanceId: z.number().int().nonnegative(),
    difficultyId: z.number().int().nonnegative(),
    name: z.string().max(128),
    difficulty: z.string().max(40).nullable(),
    total: z.number().int().nonnegative(),
    resetAt: z.string().datetime(),
    members: z
      .array(
        z
          .object({
            characterId,
            name: z.string().max(64),
            killed: z.number().int().nonnegative(),
            resetAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(MAX_ROSTER),
  })
  .strict();
export type WowRosterLockoutDto = z.infer<typeof WowRosterLockoutSchema>;

/** Cap on `lockouts[]` (one entry per instance save). */
export const MAX_ROSTER_LOCKOUTS = 200;

/** Caps on `lastSeen` (the widget shows at most 5 + 5). */
export const MAX_LAST_SEEN_ONLINE = 25;
export const MAX_LAST_SEEN_AWAY = 10;

/**
 * ROK-1916 (W9 "Last seen") — presence at the latest LedgerLink guild export,
 * never "online now". `reported` = roster rows whose export carried presence
 * (0 = no presence-bearing export yet). `online` is in roster order (rank,
 * then name); `away` = offline rows with a day count, most days first.
 * `days` = whole days offline before the export (0 = under a day).
 */
export const WowRosterLastSeenSchema = z
  .object({
    reported: z.number().int().nonnegative(),
    onlineCount: z.number().int().nonnegative(),
    online: z
      .array(
        z
          .object({
            name: z.string().max(64),
            characterId: characterId.nullable(),
          })
          .strict(),
      )
      .max(MAX_LAST_SEEN_ONLINE),
    away: z
      .array(
        z
          .object({
            name: z.string().max(64),
            characterId: characterId.nullable(),
            days: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(MAX_LAST_SEEN_AWAY),
  })
  .strict();
export type WowRosterLastSeenDto = z.infer<typeof WowRosterLastSeenSchema>;

export const WowRosterInsightsSchema = z
  .object({
    classes: z.array(WowRosterClassSchema).max(40),
    levels: WowRosterLevelsSchema,
    roles: z
      .object({ dungeon: RoleCountsSchema, raid: RoleCountsSchema })
      .strict(),
    /** Members and staff only; absent for visitors. */
    professions: z.array(WowRosterProfessionSchema).max(40).optional(),
    /** ROK-1914 — members and staff only; absent for visitors. */
    lockouts: z
      .array(WowRosterLockoutSchema)
      .max(MAX_ROSTER_LOCKOUTS)
      .optional(),
    /**
     * ROK-1914 — how many characters' addon exports reported lockouts (an
     * empty list counts; a guild-only import does not). Members/staff only,
     * beside `lockouts`; the "Who's saved" reporting line.
     */
    lockoutReporters: z.number().int().nonnegative().optional(),
    /** ROK-1916 — members and staff only; absent for visitors. */
    lastSeen: WowRosterLastSeenSchema.optional(),
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
