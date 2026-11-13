import { z } from 'zod';
import { CharacterRoleSchema } from './characters.schema.js';

/**
 * ROK-1787 (S3 of ROK-1781): guild page Raids tab + Overview widgets.
 * Payload of `GET /plugins/wow/guilds/:id/raids`. WoW-plugin owned.
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

/** Viewer's own signup state on a guild event (null = not signed up). */
export const GuildViewerStatusSchema = z
  .enum(['signed_up', 'tentative', 'declined'])
  .nullable();

/** Upcoming guild event card. */
export const GuildEventCardSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  signupCount: z.number().int(),
  /**
   * ROK-2185 — how many of `signupCount` are members of the hub (the hub
   * kind's member set). Optional: older payloads omit it.
   */
  memberSignupCount: z.number().int().min(0).optional(),
  /** Sum of slotConfig role counts, else maxAttendees; null = uncapped. */
  needed: z.number().int().nullable(),
  viewerStatus: GuildViewerStatusSchema,
  /**
   * ROK-1906 — the dungeons/raids the event is planned for (`content_instances`),
   * so the dungeon-quests widget can pick events with content. Optional.
   */
  contentInstances: z
    .array(z.object({ id: z.number().int(), name: z.string().max(200) }))
    .max(20)
    .optional(),
});
export type GuildEventCardDto = z.infer<typeof GuildEventCardSchema>;

/** Guild event that ended in the attendance window. */
export const GuildRecentEventSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  startTime: z.string().datetime(),
  signedUp: z.number().int(),
  /** null = attendance not recorded for this event. */
  attended: z.number().int().nullable(),
});
export type GuildRecentEventDto = z.infer<typeof GuildRecentEventSchema>;

/**
 * ROK-2185 item 3 — `GET /guilds/:id/events/past` pages back through the
 * hub's FULL ended-event history (operator ruling Q4 = A), newest first,
 * a fixed 20 per page. Cards reuse the `raids.recent` shape.
 */
export const GUILD_PAST_EVENTS_PAGE_SIZE = 20;

/** Opaque keyset cursor; the server alone knows its encoding. */
const PastEventsCursorSchema = z.string().min(1).max(200);

/** Query of `GET /guilds/:id/events/past`; no cursor = the newest page. */
export const GuildPastEventsQuerySchema = z.object({
  cursor: PastEventsCursorSchema.optional(),
});
export type GuildPastEventsQueryDto = z.infer<
  typeof GuildPastEventsQuerySchema
>;

/** One page of ended hub events; `nextCursor` null = no older events. */
export const GuildPastEventsPageSchema = z.object({
  events: z.array(GuildRecentEventSchema).max(GUILD_PAST_EVENTS_PAGE_SIZE),
  nextCursor: PastEventsCursorSchema.nullable(),
});
export type GuildPastEventsPageDto = z.infer<typeof GuildPastEventsPageSchema>;

/** One recurring raid night = the next occurrence of a recurrence group. */
export const GuildScheduleNightSchema = z.object({
  recurrenceGroupId: z.string().uuid(),
  eventId: z.number().int(),
  title: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable(),
  isNext: z.boolean(),
});
export type GuildScheduleNightDto = z.infer<typeof GuildScheduleNightSchema>;

export const GuildRoleNeedSchema = z.object({
  role: CharacterRoleSchema,
  filled: z.number().int(),
  needed: z.number().int(),
});
export type GuildRoleNeedDto = z.infer<typeof GuildRoleNeedSchema>;

/** Role composition + bench for the next MMO-slotted guild event. */
export const GuildCompositionSchema = z.object({
  event: z.object({
    id: z.number().int(),
    title: z.string(),
    startTime: z.string().datetime(),
  }),
  roles: z.array(GuildRoleNeedSchema),
  benched: z.array(
    z.object({ characterId: z.string().uuid().nullable(), name: z.string() }),
  ),
});
export type GuildCompositionDto = z.infer<typeof GuildCompositionSchema>;

/** Attendance leaderboard row (current linked guild members only). */
export const GuildAttendanceRowSchema = z.object({
  userId: z.number().int(),
  characterId: z.string().uuid().nullable(),
  name: z.string(),
  attended: z.number().int(),
  of: z.number().int(),
});
export type GuildAttendanceRowDto = z.infer<typeof GuildAttendanceRowSchema>;

export const GuildRaidsSchema = z.object({
  upcoming: z.array(GuildEventCardSchema),
  recent: z.array(GuildRecentEventSchema),
  schedule: z.array(GuildScheduleNightSchema),
  composition: GuildCompositionSchema.nullable(),
  attendance: z.object({
    windowWeeks: z.literal(8),
    rows: z.array(GuildAttendanceRowSchema),
  }),
  nextRaid: GuildEventCardSchema.nullable(),
});
export type GuildRaidsDto = z.infer<typeof GuildRaidsSchema>;
