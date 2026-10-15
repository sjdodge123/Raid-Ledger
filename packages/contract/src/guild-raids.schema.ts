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
  /** Sum of slotConfig role counts, else maxAttendees; null = uncapped. */
  needed: z.number().int().nullable(),
  viewerStatus: GuildViewerStatusSchema,
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
