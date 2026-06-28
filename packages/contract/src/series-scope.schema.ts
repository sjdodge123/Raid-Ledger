import { z } from 'zod';

/**
 * Scope options for series operations (Google Calendar-style).
 *
 * Lives in its own dependency-free module so `event-series.schema.ts` (the
 * series update/delete/cancel schemas) can import it without forming a circular
 * import with `events.schema.ts`. The cycle (`events ↔ event-series`) crashed
 * the built ESM at boot with a TDZ `Cannot access 'UpdateEventSchema' before
 * initialization`.
 */
export const SeriesScopeSchema = z.enum(['this', 'this_and_following', 'all']);

export type SeriesScope = z.infer<typeof SeriesScopeSchema>;
