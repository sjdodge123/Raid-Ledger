import { z } from 'zod';

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
export const GameTimeAbsenceSchema = z.object({
  id: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
});
export type GameTimeAbsence = z.infer<typeof GameTimeAbsenceSchema>;

/**
 * Absence input schema (for creating absences).
 */
export const GameTimeAbsenceInputSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().max(255).optional(),
});
export type GameTimeAbsenceInput = z.infer<typeof GameTimeAbsenceInputSchema>;

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
});
export type GameTimeResponse = z.infer<typeof GameTimeResponseSchema>;
