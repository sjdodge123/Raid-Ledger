/**
 * Pure time helpers for the LFG integration specs. Kept out of
 * `lfg.integration.spec-helpers.ts` (which pulls in the Nest test app) so a
 * plain unit spec can pin them with fake timers.
 */

/**
 * Whole minutes from now until `expiresAt`, rounded UP — horizons differ by
 * hours, so a minute of slack never matters, but any instant still ahead of
 * now must read as > 0. `Math.round` turned a 03:59:45Z POST for a 04:00Z
 * `tonight` expiry into 0 and flaked `lfg-urgency.integration.spec.ts`.
 */
export function minutesFromNow(expiresAt: string | Date): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000);
}
