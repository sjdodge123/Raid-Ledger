import { z } from 'zod';
import { CalendarProviderSchema } from './calendar-sync.schema.js';

/**
 * Status states for game time slots (ROK-189).
 * Reuses the same status vocabulary as availability for future overlay compatibility (ROK-201).
 */
export const GameTimeStatusEnum = z.enum([
  'available',
  'committed',
  'blocked',
  'freed',
]);
export type GameTimeStatus = z.infer<typeof GameTimeStatusEnum>;

/**
 * A single game time slot: day-of-week + hour + optional status.
 * fromTemplate distinguishes user-set template slots from event-only committed slots
 * that the composite view injects for calendar display.
 */
export const GameTimeSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  status: GameTimeStatusEnum.optional(),
  fromTemplate: z.boolean().optional(),
});
export type GameTimeSlot = z.infer<typeof GameTimeSlotSchema>;

/**
 * Template input: just day/hour pairs (status is always 'available' for templates).
 * Max 168 slots = 7 days x 24 hours.
 */
export const GameTimeTemplateInputSchema = z.object({
  slots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        hour: z.number().int().min(0).max(23),
      }),
    )
    .max(168),
});
export type GameTimeTemplateInput = z.infer<typeof GameTimeTemplateInputSchema>;

/**
 * An event block descriptor for rendering on the game time grid.
 * Returned by the composite view to overlay actual events on the heatmap.
 */
export const GameTimeEventBlockSchema = z.object({
  eventId: z.number(),
  title: z.string(),
  gameSlug: z.string().nullable(),
  gameName: z.string().nullable(),
  /** ROK-400: games.id (integer) for character avatar matching */
  gameId: z.number().nullable().optional(),
  coverUrl: z.string().nullable(),
  signupId: z.number(),
  confirmationStatus: z.enum(['pending', 'confirmed', 'changed']),
  dayOfWeek: z.number().int().min(0).max(6),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24), // exclusive, 24 = end of day
  // Enriched fields for calendar-parity rendering
  description: z.string().nullable().optional(),
  creatorUsername: z.string().nullable().optional(),
  signupsPreview: z
    .array(
      z.object({
        id: z.number(),
        username: z.string(),
        avatar: z.string().nullable(),
        characters: z
          .array(z.object({ gameId: z.number(), avatarUrl: z.string().nullable() }))
          .optional(),
      }),
    )
    .optional(),
  signupCount: z.number().optional(),
});
export type GameTimeEventBlock = z.infer<typeof GameTimeEventBlockSchema>;

/**
 * Per-hour date-specific override input.
 */
export const GameTimeOverrideInputSchema = z.object({
  overrides: z.array(
    z.object({
      date: z.string(), // ISO date (YYYY-MM-DD)
      hour: z.number().int().min(0).max(23),
      status: z.enum(['available', 'blocked']),
    }),
  ),
});
export type GameTimeOverrideInput = z.infer<typeof GameTimeOverrideInputSchema>;

/**
 * Absence range schema (returned from API).
 */
export const GameTimeAbsenceSourceSchema = z.enum(['manual', 'calendar']);
export type GameTimeAbsenceSource = z.infer<typeof GameTimeAbsenceSourceSchema>;

export const GameTimeAbsenceSchema = z.object({
  id: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
  /**
   * ROK-1593: where the absence came from. Optional (additive) — a payload
   * without it is a manual absence. `calendar` rows are derived by sync and
   * are dismissed with Ignore, never deleted.
   */
  source: GameTimeAbsenceSourceSchema.optional(),
  /** ROK-1593: the calendar provider a `calendar` absence was derived from. */
  provider: CalendarProviderSchema.optional(),
});
export type GameTimeAbsence = z.infer<typeof GameTimeAbsenceSchema>;

const ABSENCE_DATE_KEYS: PropertyKey[] = ['startDate', 'endDate'];

/**
 * Absence input schema (for creating absences).
 * Both dates are strict ISO calendar dates (YYYY-MM-DD) and the range may not
 * end before it starts. ROK-1842: both dates must fall inside
 * `ABSENCE_MIN_DATE..ABSENCE_MAX_DATE` and the range may span at most
 * `ABSENCE_MAX_SPAN_DAYS` — an unbounded 0001..9999 row made every composite
 * read walk 3.64M days. The range checks only run once both dates parsed, so
 * a malformed date reports one issue on its own field.
 *
 * Supplying `when` replaces zod's default guard, so it must also skip a
 * root-level issue (a missing body or a non-object input): otherwise the
 * refine reads `endDate` off `undefined` and throws.
 */
export const ABSENCE_MIN_DATE = '2000-01-01';
export const ABSENCE_MAX_DATE = '2100-12-31';
/** Longest absence, in days counted inclusively (ROK-1842). */
export const ABSENCE_MAX_SPAN_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inclusive day count of an ordered pair of ISO dates. */
function inclusiveDays(startDate: string, endDate: string): number {
  const ms =
    Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(ms / DAY_MS) + 1;
}

const inWindow = (date: string) =>
  date >= ABSENCE_MIN_DATE && date <= ABSENCE_MAX_DATE;

/** True while no date (or root-level) issue has been reported yet. */
const noDateIssues = ({ issues }: z.core.ParsePayload) =>
  !issues.some((i) => {
    const key = i.path?.[0];
    return key === undefined || ABSENCE_DATE_KEYS.includes(key);
  });

const WINDOW_MESSAGE = `date must be between ${ABSENCE_MIN_DATE} and ${ABSENCE_MAX_DATE}`;

export const GameTimeAbsenceInputSchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    reason: z.string().max(255).optional(),
  })
  // ISO dates compare correctly as strings.
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
    when: noDateIssues,
  })
  .refine((v) => inWindow(v.startDate), {
    message: WINDOW_MESSAGE,
    path: ['startDate'],
    when: noDateIssues,
  })
  .refine((v) => inWindow(v.endDate), {
    message: WINDOW_MESSAGE,
    path: ['endDate'],
    when: noDateIssues,
  })
  .refine(
    (v) => inclusiveDays(v.startDate, v.endDate) <= ABSENCE_MAX_SPAN_DAYS,
    {
      message: `an absence may span at most ${ABSENCE_MAX_SPAN_DAYS} days`,
      path: ['endDate'],
      when: noDateIssues,
    },
  );
export type GameTimeAbsenceInput = z.infer<typeof GameTimeAbsenceInputSchema>;

/**
 * One busy hour range from a synced calendar on the viewer's own grid
 * (ROK-1593 §3.6, S2). `dayOfWeek` follows the display convention of
 * `GameTimeSlotSchema`, not the DB's 0=Monday. `.strict()` so no event
 * detail (title, location) can ride along.
 */
export const GameTimeCalendarBusySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24), // exclusive, 24 = end of day
    provider: CalendarProviderSchema,
  })
  .strict();
export type GameTimeCalendarBusy = z.infer<typeof GameTimeCalendarBusySchema>;

/**
 * Response: includes optional status for future week-view overlay (ROK-201).
 */
export const GameTimeResponseSchema = z.object({
  slots: z.array(GameTimeSlotSchema),
  events: z.array(GameTimeEventBlockSchema).optional(),
  weekStart: z.string().optional(),
  overrides: z
    .array(
      z.object({
        date: z.string(),
        hour: z.number(),
        status: z.string(),
      }),
    )
    .optional(),
  absences: z.array(GameTimeAbsenceSchema).optional(),
  /**
   * True if game_time_confirmed_at is null or older than the shared freshness
   * window (`GAME_TIME_FRESHNESS_DAYS`) (ROK-999, window sourced from the
   * server helper since ROK-1560).
   */
  gameTimeStale: z.boolean().optional(),
  /**
   * Whole days since the viewer last confirmed their game time; `null` when it
   * was never confirmed (ROK-1564).
   */
  gameTimeAgeDays: z.number().int().min(0).nullable().optional(),
  /** Synced-calendar busy hours, own view only (ROK-1593). */
  calendarBusy: z.array(GameTimeCalendarBusySchema).optional(),
});
export type GameTimeResponse = z.infer<typeof GameTimeResponseSchema>;

/**
 * Response for `PATCH /users/me/game-time/confirm` — the confirm-only save.
 * Stale means unconfirmed, not unedited, so confirming writes no template
 * (ROK-1564).
 */
export const GameTimeConfirmResponseSchema = z.object({
  confirmedAt: z.string().datetime(),
});
export type GameTimeConfirmResponse = z.infer<
  typeof GameTimeConfirmResponseSchema
>;
