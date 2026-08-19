/**
 * Server-side gating for Co-Optimus editorial prose (ROK-1398, AC4).
 *
 * The Co-Optimus data grant (ROK-275) covers the co-op *facts* — player counts,
 * campaign/drop-in/LAN support. The editorial prose ("The Co-Op Experience"
 * blurb and their game description) is only redistributed once the operator
 * explicitly opts in via `cooptimusProseEnabled`.
 *
 * Gating lives HERE rather than in the web client so unlicensed prose never
 * leaves the API. The strip is surgical: every other extras key (system,
 * steamAppId, featurelist, downloadableOnly) and every co-op fact still ships,
 * and a null extras blob stays null rather than becoming an empty object.
 */
import type { GameDetailDto } from '@raid-ledger/contract';

/** Extras keys that carry Co-Optimus editorial prose. */
const PROSE_KEYS = ['coopExperience', 'description'] as const;

/**
 * Remove the prose fields from a detail DTO's `cooptimusExtras` unless the
 * operator has enabled prose.
 *
 * @param game - Detail DTO carrying `cooptimusExtras` (already mapped)
 * @param proseEnabled - Resolved value of the `cooptimusProseEnabled` setting
 * @returns The same DTO when prose is enabled or there is nothing to strip,
 *          otherwise a shallow copy with the prose keys omitted.
 */
export function stripCooptimusProse<T extends Pick<GameDetailDto, 'cooptimusExtras'>>(
  game: T,
  proseEnabled: boolean,
): T {
  if (proseEnabled) return game;
  const extras = game.cooptimusExtras;
  if (!extras) return game;

  const kept = { ...extras };
  let stripped = false;
  for (const key of PROSE_KEYS) {
    if (key in kept) {
      delete kept[key];
      stripped = true;
    }
  }
  return stripped ? { ...game, cooptimusExtras: kept } : game;
}
