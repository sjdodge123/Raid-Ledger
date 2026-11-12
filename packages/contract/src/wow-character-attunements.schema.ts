import { z } from "zod";
import {
  MAX_ATTUNEMENT_STEPS,
  MAX_ROSTER_ATTUNEMENTS,
  WowAttunementStateSchema,
} from "./wow-roster-attunements.schema.js";

/**
 * ROK-1927 (§5.3 own view) — one character's attunement checklists inside
 * `GET /plugins/wow/characters/:id/quests`. Only tracked definitions of the
 * character's faction whose final quest Blizzard confirmed; only confirmed
 * steps (Lead call 2026-11-12). Labels and done flags — never a quest id.
 */

const label = z.string().max(128);

/** One step of the checklist, in chain order. */
export const WowCharacterAttunementStepSchema = z
  .object({ label, done: z.boolean() })
  .strict();
export type WowCharacterAttunementStepDto = z.infer<
  typeof WowCharacterAttunementStepSchema
>;

export const WowCharacterAttunementSchema = z
  .object({
    key: z.string().max(40),
    /** Faction variants share one group (Onyxia). */
    groupKey: z.string().max(40),
    instance: z.string().max(64),
    state: WowAttunementStateSchema,
    /** Below the chain's level step — an annotation, not a verdict. */
    belowLevel: z.boolean(),
    /** The chain's level step ("needs 55"); null when it has none. */
    requiredLevel: z.number().int().min(0).max(100).nullable(),
    /** Label of the first incomplete step; null when done / no data. */
    nextStep: label.nullable(),
    steps: z.array(WowCharacterAttunementStepSchema).max(MAX_ATTUNEMENT_STEPS),
  })
  .strict();
export type WowCharacterAttunementDto = z.infer<
  typeof WowCharacterAttunementSchema
>;

export const WowCharacterAttunementsSchema = z
  .array(WowCharacterAttunementSchema)
  .max(MAX_ROSTER_ATTUNEMENTS);
export type WowCharacterAttunementsDto = z.infer<
  typeof WowCharacterAttunementsSchema
>;
