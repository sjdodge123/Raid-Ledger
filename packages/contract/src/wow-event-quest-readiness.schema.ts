import { z } from "zod";
import { HubFactSourceSchema } from "./hub-facts.schema.js";

/**
 * ROK-1906 (epic ROK-1905) — `GET /plugins/wow-classic/events/:eventId/quest-readiness`:
 * every signup's progress on the event's dungeon quests (extends ROK-1748's
 * per-viewer progress to the whole roster). Forever events only.
 */
export const QuestReadinessStateSchema = z.enum([
  "done",
  "have",
  "missing",
  "unknown",
]);
export type QuestReadinessState = z.infer<typeof QuestReadinessStateSchema>;

export const EventQuestReadinessSchema = z
  .object({
    quests: z
      .array(
        z
          .object({
            questId: z.number().int().positive(),
            title: z.string().max(200),
            instanceId: z.number().int(),
          })
          .strict(),
      )
      .max(200),
    signups: z
      .array(
        z
          .object({
            userId: z.number().int().positive(),
            /** `characters.id` (uuid); null when the signup has no character. */
            characterId: z.string().uuid().nullable(),
            name: z.string().max(64),
            perQuest: z
              .array(
                z
                  .object({
                    questId: z.number().int().positive(),
                    state: QuestReadinessStateSchema,
                    prereqsMet: z.boolean().nullable(),
                    source: HubFactSourceSchema.nullable(),
                  })
                  .strict(),
              )
              .max(200),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type EventQuestReadinessDto = z.infer<typeof EventQuestReadinessSchema>;
