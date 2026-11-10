/**
 * ROK-2153 S4 — pure mapping from Valheim armory rows to core claim
 * candidates. The match rule mirrors `pickClaimCandidate` (ROK-1933): a
 * viewer whose verified Steam differs from the character's is never a match;
 * the same Steam is a hard fact (strong); otherwise the best name strength
 * across the viewer's names (strong = exact after folding, medium = fuzzy).
 * Core picks `suggested` (exactly one strong), never this file.
 */
import type {
  HubClaimCandidate,
  HubClaimMatch,
  HubClaimMatchReason,
} from '@raid-ledger/contract';
import {
  nameStrength,
  type NameStrength,
} from './valheim-claim-suggest.helpers';

/** What the provider knows about the viewer for matching. */
export interface ValheimClaimViewer {
  /** RL username, display name (when set). */
  names: string[];
  /** The viewer's Raid-Ledger-verified SteamID64, if linked. */
  steamId: string | null;
}

/** The armory row fields a candidate needs. */
export interface ValheimClaimRow {
  id: number;
  name: string;
  worldName: string;
  steamId: string;
}

interface Match {
  match: HubClaimMatch | null;
  matchReason: HubClaimMatchReason | null;
}

const NO_MATCH: Match = { match: null, matchReason: null };

/** A viewer with no facts — the claim response carries no match. */
export const NO_VIEWER: ValheimClaimViewer = { names: [], steamId: null };

const RANK: Record<NameStrength, number> = { none: 0, medium: 1, strong: 2 };

/** The best name strength across every name the viewer goes by. */
function bestName(row: ValheimClaimRow, names: readonly string[]): number {
  return Math.max(0, ...names.map((n) => RANK[nameStrength(row.name, n)]));
}

/** How strongly `row` looks like the viewer's character. */
export function matchFor(
  row: ValheimClaimRow,
  viewer: ValheimClaimViewer,
): Match {
  if (viewer.steamId !== null) {
    if (viewer.steamId !== row.steamId) return NO_MATCH;
    return { match: 'strong', matchReason: 'steam_link' };
  }
  const rank = bestName(row, viewer.names);
  if (rank === RANK.strong)
    return { match: 'strong', matchReason: 'same_name' };
  if (rank === RANK.medium)
    return { match: 'possible', matchReason: 'same_name' };
  return NO_MATCH;
}

/** One armory row as a core claim candidate (id = the armory profile id). */
export function toCandidate(
  row: ValheimClaimRow,
  viewer: ValheimClaimViewer,
): HubClaimCandidate {
  return {
    id: String(row.id),
    name: row.name.slice(0, 100),
    subtitle: `World: ${row.worldName}`.slice(0, 160),
    avatarUrl: null,
    detailPath: `/valheim/characters/${row.id}`,
    ...matchFor(row, viewer),
  };
}

/** A candidate id back to the armory profile id, or null when it is not one. */
export function parseCandidateId(candidateId: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(candidateId)) return null;
  const id = Number(candidateId);
  return id <= 2_147_483_647 ? id : null;
}
