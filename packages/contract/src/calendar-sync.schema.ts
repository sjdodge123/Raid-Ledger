import { z } from 'zod';

/**
 * Calendar Sync wire shapes (ROK-669 epic, foundation ROK-1591).
 *
 * Shapes follow `planning-artifacts/CALENDAR-PLAN-2026-10-08.md` §1.10 over
 * spec §7. The 2026-10-08 ruling made tentative sign-ups always sync, so no
 * schema carries an `includeTentative` toggle: the objects that once did are
 * `.strict()`, so a stale client sending one is rejected, not silently
 * stripped.
 */

export const CalendarProviderSchema = z.enum(['google', 'microsoft', 'apple']);
export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;

export const CalendarConnectionStatusSchema = z.enum([
  'active',
  'needs_reconnect',
  'error',
  'disconnecting',
]);
export type CalendarConnectionStatus = z.infer<
  typeof CalendarConnectionStatusSchema
>;

/** What a read connection turns into on the Game Time grid. */
export const CalendarReadModeSchema = z.enum(['days', 'hours', 'both']);
export type CalendarReadMode = z.infer<typeof CalendarReadModeSchema>;

/** Where written event copies land: our own calendar, or the user's primary. */
export const CalendarWriteTargetSchema = z.enum(['dedicated', 'primary']);
export type CalendarWriteTarget = z.infer<typeof CalendarWriteTargetSchema>;

/**
 * Look-ahead window, fixed at 4 weeks (operator decision 2026-09-16, Q8).
 * The K2 row shows it; it is not a user setting.
 */
export const CALENDAR_LOOK_AHEAD_WEEKS = 4;

/** Bounds shared with the PATCH input, which derives from these shapes. */
const CalendarIdsSchema = z.array(z.string().min(1).max(1024)).max(200);

const CalendarConnectionReadSchema = z
  .object({ enabled: z.boolean(), calendarIds: CalendarIdsSchema })
  .strict();

const CalendarConnectionWriteSchema = z
  .object({ enabled: z.boolean(), target: CalendarWriteTargetSchema })
  .strict();

/** One linked account. Credentials never appear on the wire. */
export const CalendarConnectionSchema = z
  .object({
    id: z.number().int(),
    provider: CalendarProviderSchema,
    accountLabel: z.string().nullable(),
    status: CalendarConnectionStatusSchema,
    lastSyncedAt: z.string().datetime().nullable(),
    errorCode: z.string().nullable(),
    read: CalendarConnectionReadSchema,
    write: CalendarConnectionWriteSchema,
  })
  .strict();
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;

/** A calendar inside a connected account (the read picker). */
export const ProviderCalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  writable: z.boolean(),
  isRaidLedger: z.boolean(),
});
export type ProviderCalendar = z.infer<typeof ProviderCalendarSchema>;

export const CalendarReadSettingsSchema = z
  .object({
    mode: CalendarReadModeSchema,
    /** Informational only — always `CALENDAR_LOOK_AHEAD_WEEKS`. */
    lookAheadWeeks: z.literal(CALENDAR_LOOK_AHEAD_WEEKS),
  })
  .strict();
export type CalendarReadSettings = z.infer<typeof CalendarReadSettingsSchema>;

/** The subscribe-by-URL ICS feed. Tentative sign-ups are always included. */
export const CalendarFeedSchema = z.object({ url: z.string() }).strict();
export type CalendarFeed = z.infer<typeof CalendarFeedSchema>;

/**
 * `GET /users/me/calendars`. With the kill switch off: `enabled: false`,
 * every provider unavailable, no connections, `feed: null`. The record is
 * exhaustive over the provider enum, so all three keys are always present.
 * `.strict()` like its nested shapes, so a leaked key fails the client parse.
 */
export const CalendarsOverviewSchema = z
  .object({
    enabled: z.boolean(),
    providers: z.record(
      CalendarProviderSchema,
      z.object({ available: z.boolean() }).strict(),
    ),
    connections: z.array(CalendarConnectionSchema),
    readSettings: CalendarReadSettingsSchema,
    feed: CalendarFeedSchema.nullable(),
  })
  .strict();
export type CalendarsOverview = z.infer<typeof CalendarsOverviewSchema>;

/** `PATCH /users/me/calendars/:id`. */
export const UpdateCalendarConnectionSchema = z
  .object({
    read: CalendarConnectionReadSchema.partial().optional(),
    write: CalendarConnectionWriteSchema.partial().optional(),
  })
  .strict();
export type UpdateCalendarConnection = z.infer<
  typeof UpdateCalendarConnectionSchema
>;

/** Apple app-specific password: four groups of four letters, dash-joined. */
export const APPLE_APP_PASSWORD_PATTERN = /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/i;

/** `POST /users/me/calendars/apple`. */
export const AppleConnectInputSchema = z
  .object({
    email: z.string().email().max(255),
    appPassword: z.string().regex(APPLE_APP_PASSWORD_PATTERN, {
      message: 'appPassword must look like xxxx-xxxx-xxxx-xxxx',
    }),
  })
  .strict();
export type AppleConnectInput = z.infer<typeof AppleConnectInputSchema>;

/** `GET /users/me/calendars/oauth/:provider/start`. */
export const OAuthStartResponseSchema = z.object({ url: z.string().url() });
export type OAuthStartResponse = z.infer<typeof OAuthStartResponseSchema>;

/** `GET /users/me/calendars/events/:eventId` — our copy of one event. */
export const EventCalendarCopySchema = z.object({
  provider: CalendarProviderSchema,
  state: z.enum(['pending', 'synced', 'failed', 'suppressed']),
  openUrl: z.string().url().nullable(),
});
export type EventCalendarCopy = z.infer<typeof EventCalendarCopySchema>;
