import { z } from "zod";
import { HubFactSourceSchema } from "./hub-facts.schema.js";

/**
 * ROK-1927 (W13 "Attunements") — the members-only attunement section of
 * `GET /plugins/wow/guilds/:id/roster-insights`. Verdicts and step LABELS
 * only: no quest id and no completed-quest list ever leaves the api (spec
 * D2, AC10). Attunements whose ids Blizzard has not confirmed are omitted
 * (an empty `attunements[]` = "not verified yet").
 */

/** Most attunement definitions the payload carries (v1 has six). */
export const MAX_ROSTER_ATTUNEMENTS = 20;
/** Most members (the roster-insights 2000-row bound). */
export const MAX_ROSTER_ATTUNEMENT_MEMBERS = 2000;
/** Longest chain the payload describes (Onyxia Alliance is 16 quests). */
export const MAX_ATTUNEMENT_STEPS = 40;

const count = z.number().int().nonnegative();
const iso = z.iso.datetime({ offset: true });
const label = z.string().max(128);

export const WowAttunementStateSchema = z.enum([
  "done",
  "in_progress",
  "not_started",
  "no_data",
]);
export type WowAttunementState = z.infer<typeof WowAttunementStateSchema>;

/** Why a member is `no_data` (spec §7). */
export const WowAttunementNoDataReasonSchema = z.enum([
  "no_quest_data",
  "not_claimed",
  "truncated",
]);
export type WowAttunementNoDataReason = z.infer<
  typeof WowAttunementNoDataReasonSchema
>;

export const WowAttunementFactionSchema = z.enum(["horde", "alliance", "both"]);

/** One attunement definition with its roster tally. */
export const WowRosterAttunementSchema = z
  .object({
    key: z.string().max(40),
    /** Faction variants share one group (Onyxia); the summary counts it once. */
    groupKey: z.string().max(40),
    instance: z.string().max(64),
    faction: WowAttunementFactionSchema,
    /** False = greyed "not tracked yet"; excluded from counts (AC8). */
    trackable: z.boolean(),
    /** Why it is untracked (e.g. a reputation gate); null when tracked. */
    untrackedReason: z.string().max(128).nullable(),
    /** Ordered step labels (the checklist); quest ids are never sent. */
    steps: z.array(label).max(MAX_ATTUNEMENT_STEPS),
    counts: z
      .object({
        done: count,
        inProgress: count,
        notStarted: count,
        noData: count,
      })
      .strict(),
  })
  .strict();
export type WowRosterAttunementDto = z.infer<typeof WowRosterAttunementSchema>;

/** One member's verdict on one attunement. */
export const WowAttunementResultSchema = z
  .object({
    key: z.string().max(40),
    state: WowAttunementStateSchema,
    /** Set only when `state` is `no_data`. */
    noDataReason: WowAttunementNoDataReasonSchema.nullable(),
    /** Completed steps, by the order of the definition's `steps`. */
    stepsDone: count,
    /** Label of the first incomplete quest step; null when done / no data. */
    nextStep: label.nullable(),
    /** Below the chain's level step — an annotation, not a verdict (D3). */
    belowLevel: z.boolean(),
  })
  .strict();
export type WowAttunementResultDto = z.infer<typeof WowAttunementResultSchema>;

/** One roster row (mains only, ruling D) with a result per relevant def. */
export const WowRosterAttunementMemberSchema = z
  .object({
    /** Stable row key: `characterId ?? 'm' + guild member id`. */
    rowKey: z.string().max(64),
    name: z.string().max(64),
    /** Null for an unclaimed roster member (always `not_claimed`). */
    characterId: z.string().uuid().nullable(),
    cls: z.string().max(40).nullable(),
    level: z.number().int().min(0).max(100).nullable(),
    /** The member's quest list capture time; null without quest data. */
    asOf: iso.nullable(),
    source: HubFactSourceSchema.nullable(),
    /** Only the definitions of the member's faction (D7). */
    results: z.array(WowAttunementResultSchema).max(MAX_ROSTER_ATTUNEMENTS),
  })
  .strict();
export type WowRosterAttunementMemberDto = z.infer<
  typeof WowRosterAttunementMemberSchema
>;

export const WowRosterAttunementsSchema = z
  .object({
    attunements: z
      .array(WowRosterAttunementSchema)
      .max(MAX_ROSTER_ATTUNEMENTS),
    members: z
      .array(WowRosterAttunementMemberSchema)
      .max(MAX_ROSTER_ATTUNEMENT_MEMBERS),
    /** Oldest contributing member `asOf` (the footer's honest bound, D8). */
    oldestAsOf: iso.nullable(),
  })
  .strict();
export type WowRosterAttunementsDto = z.infer<
  typeof WowRosterAttunementsSchema
>;
