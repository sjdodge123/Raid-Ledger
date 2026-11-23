import { z } from "zod";

/**
 * Event-planning forum (ROK-2272). Non-hub events, scheduling polls and
 * lineups post into the one Discord forum the hubs already use, tagged with
 * their kind only. With ≥2 bound forums in the Discord guild the admin picks
 * which one (setting `discord_bot_event_planning_forum`); exactly one is used
 * automatically; none means non-hub subjects get no Discord post.
 */

/** A Discord snowflake: 17-20 digits, nothing else. */
const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "channelId must be a Discord channel id");

/** Forum tag names per subject kind (reserved: a hub cannot take them). */
export const EVENT_PLANNING_TAGS = {
  event: "Event",
  poll: "Poll",
  lineup: "Lineup",
} as const;
export type EventPlanningTagKind = keyof typeof EVENT_PLANNING_TAGS;
export type EventPlanningTagName =
  (typeof EVENT_PLANNING_TAGS)[EventPlanningTagKind];

/** A bound Discord forum the admin may pick. */
export const EventPlanningForumCandidateSchema = z
  .object({
    channelId: snowflake,
    name: z.string(),
    /** The bot created this forum (vs an existing one a hub bound). */
    managed: z.boolean(),
  })
  .strict();
export type EventPlanningForumCandidate = z.infer<
  typeof EventPlanningForumCandidateSchema
>;

/** `GET` admin settings: the stored pick, the candidates and the result. */
export const EventPlanningForumSettingsSchema = z
  .object({
    /** The stored setting; null when unset. */
    channelId: snowflake.nullable(),
    candidates: z.array(EventPlanningForumCandidateSchema),
    /** The forum non-hub posts go to right now; null = none. */
    resolvedChannelId: snowflake.nullable(),
    /** Why nothing resolved (e.g. ≥2 forums and no valid pick). */
    warning: z.string().optional(),
  })
  .strict();
export type EventPlanningForumSettingsDto = z.infer<
  typeof EventPlanningForumSettingsSchema
>;

/** `PUT` admin settings body; null clears the pick. */
export const UpdateEventPlanningForumSchema = z
  .object({ channelId: snowflake.nullable() })
  .strict();
export type UpdateEventPlanningForumDto = z.infer<
  typeof UpdateEventPlanningForumSchema
>;
