import { z } from 'zod';
import { UpdateEventSchema } from './events.schema.js';
import { SeriesScopeSchema } from './series-scope.schema.js';

// Re-exported from its own module to break the events ↔ event-series import
// cycle (ROK-1352). Existing importers of `SeriesScopeSchema` / `SeriesScope`
// from this file keep working.
export { SeriesScopeSchema } from './series-scope.schema.js';
export type { SeriesScope } from './series-scope.schema.js';

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
