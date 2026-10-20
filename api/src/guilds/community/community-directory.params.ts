import type { GameHubs } from '@raid-ledger/contract';
import {
  encodeCursor,
  type DirectoryCursor,
} from './community-directory.cursor';
import { MAX_OPEN_PROPOSALS } from './community-proposals.service';

/** ROK-1870 L3 — the pure pieces of `GET /hubs` and `GET /hubs/by-game`. */

/** Escape `\`, `%` and `_` so a search is matched literally by ILIKE. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A keyset page: drop the limit+1 probe row, cursor from the last kept row. */
export function pageOf<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => DirectoryCursor,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const more = rows.length > limit && last !== undefined;
  return { items, nextCursor: more ? encodeCursor(keyOf(last)) : null };
}

/**
 * Why the viewer may not propose a hub for `gameId` (A2, then D12), or null.
 * Mirrors `CommunityProposalsService.propose`'s refusal order.
 */
export function proposeBlockedReason(
  inDiscord: boolean,
  openGameIds: number[],
  gameId: number,
): GameHubs['proposeBlockedReason'] {
  if (!inDiscord) return 'not-in-discord';
  if (openGameIds.includes(gameId)) return 'pending-for-game';
  if (openGameIds.length >= MAX_OPEN_PROPOSALS) return 'limit-reached';
  return null;
}
