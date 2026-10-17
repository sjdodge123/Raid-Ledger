/**
 * Pure resolution gate for ephemeral voice channels (ROK-1352).
 *
 * Resolution order:
 *   1. Global master toggle off → false (master gate)
 *   2. Force-ephemeral on        → true  (admin: always create, never reuse a
 *                                          pre-existing/static channel)
 *   3. Per-event opt-in          → use it (null/false ⇒ no channel)
 *   4. else                      → false (default off)
 *
 * Series-wide enablement is NOT a tier here: it propagates as the per-event
 * column across instances via the ROK-429 scope flow (PATCH /events/:id/series).
 *
 * Takes already-resolved inputs so it is unit-testable with no infrastructure.
 */
export function shouldCreateEphemeralChannel(
  globalEnabled: boolean,
  forced: boolean,
  eventOverride: boolean | null,
): boolean {
  if (!globalEnabled) return false;
  if (forced) return true;
  return eventOverride ?? false;
}
