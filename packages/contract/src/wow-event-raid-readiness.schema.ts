import { z } from "zod";
import {
  HubFactFreshnessSchema,
  HubFactSourceSchema,
} from "./hub-facts.schema.js";

/**
 * ROK-1926 (epic ROK-1905) — `GET /plugins/wow-classic/events/:eventId/raid-readiness`:
 * the "Ready for next run" checklist. Per active signup of the next guild event
 * with content: level, dungeon quests, lockout and item level. Missing data is
 * `unknown`, never `fail`; a check the event has no requirement for is `na`.
 */
export const ReadyCheckStateSchema = z.enum(["pass", "fail", "unknown", "na"]);
export type ReadyCheckState = z.infer<typeof ReadyCheckStateSchema>;

const int = z.number().int();

const readyCheck = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      state: ReadyCheckStateSchema,
      /** What was compared (level 52, item level 49, …). */
      value: value.nullable(),
      source: HubFactSourceSchema.nullable(),
    })
    .strict();

export const EventRaidReadinessSchema = z
  .object({
    event: z
      .object({
        id: int,
        title: z.string().max(200),
        startTime: z.string().datetime(),
      })
      .strict(),
    requirements: z
      .object({
        /** Lowest minimum level across the event's content instances. */
        minLevel: int.nullable(),
        /** `foreverIlvlFloor(minLevel)`; null when minLevel is null. */
        ilvlFloor: int.nullable(),
        /** Raid instances the "saved" check looks at; [] = not applicable. */
        raidNames: z.array(z.string().max(200)).max(20),
        /** Quests known for the event's instances; 0 = quest check not applicable. */
        questCount: int.nonnegative(),
      })
      .strict(),
    signups: z
      .array(
        z
          .object({
            userId: int.positive(),
            characterId: z.string().uuid().nullable(),
            name: z.string().max(64),
            level: readyCheck(int),
            quests: z
              .object({
                state: ReadyCheckStateSchema,
                ready: int.nonnegative(),
                total: int.nonnegative(),
              })
              .strict(),
            saved: z
              .object({
                state: ReadyCheckStateSchema,
                instanceName: z.string().max(200).nullable(),
                resetAt: z.string().datetime().nullable(),
              })
              .strict(),
            /** Rounded for display; the comparison used the raw average. */
            ilvl: readyCheck(int),
            overall: ReadyCheckStateSchema.exclude(["na"]),
          })
          .strict(),
      )
      .max(100),
    /** The oldest fact that fed any cell. */
    freshness: HubFactFreshnessSchema.nullable(),
  })
  .strict();
export type EventRaidReadiness = z.infer<typeof EventRaidReadinessSchema>;
