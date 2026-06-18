import { z } from 'zod';

/**
 * Scope options for series operations (Google Calendar-style).
 *
 * Lives in its own dependency-free module so BOTH `events.schema.ts` (needs it
 * for `ephemeralVoiceScope`, ROK-1352) and `event-series.schema.ts` (needs it
 * for the series update/delete/cancel schemas) can import it without forming a
 * circular import. The cycle (`events ↔ event-series`) crashed the built ESM at
 * boot with a TDZ `Cannot access 'UpdateEventSchema' before initialization`.
 */
export const SeriesScopeSchema = z.enum(['this', 'this_and_following', 'all']);

export type SeriesScope = z.infer<typeof SeriesScopeSchema>;
