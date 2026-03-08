import { z } from 'zod';
import { UpdateEventSchema } from './events.schema.js';

/** Scope options for series operations (Google Calendar-style). */
export const SeriesScopeSchema = z.enum(['this', 'this_and_following', 'all']);

export type SeriesScope = z.infer<typeof SeriesScopeSchema>;

/** Schema for updating a series of events. */
export const UpdateSeriesSchema = z.object({
    scope: SeriesScopeSchema,
    data: UpdateEventSchema,
});

export type UpdateSeriesDto = z.infer<typeof UpdateSeriesSchema>;

/** Schema for deleting a series of events. */
export const DeleteSeriesSchema = z.object({
    scope: SeriesScopeSchema,
});

export type DeleteSeriesDto = z.infer<typeof DeleteSeriesSchema>;

/** Schema for cancelling a series of events. */
export const CancelSeriesSchema = z.object({
    scope: SeriesScopeSchema,
    reason: z.string().max(500).optional(),
});

export type CancelSeriesDto = z.infer<typeof CancelSeriesSchema>;
