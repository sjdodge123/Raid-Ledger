/**
 * ROK-1446 — cover art + badge inputs for every group in a presence room.
 *
 * Lead ruling 1 (2026-09-04): D2 gives a SHORT group "same badge fields,
 * thumbnail", and the mixed-room mock draws `👥 Co-op / 10 online` plus cover
 * art on the amber Valheim group. An EVENTED group inherits that from its
 * `EmbedEventData.game`; a short group has no event, so `ResolvedRoom` has to
 * carry it. Until this landed the short group rendered visibly thinner than the
 * approved design — the one place output was knowingly behind the mock.
 *
 * ONE read per flush, not one per group: both `resolveRoom` paths (live
 * detection and the D12 snapshot) funnel their game ids through `fetchGameArt`,
 * and the snapshot path takes its display names off the same rows it takes the
 * art off, rather than issuing a second `games` select.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { GameBadgeInputs } from '../embeds/embed-badges.helpers';
import {
  QUICK_PLAY_GAME_COLUMNS,
  toQuickPlayGame,
  type EmbedGame,
  type QuickPlayGameRow,
} from './embed-game.helpers';

/**
 * The art a group embed renders: the thumbnail and the two badge inputs.
 *
 * Deliberately looser than `EmbedGame` — the renderer never needs the id or the
 * name (the group already carries both), so a caller may hand it art that has
 * neither. `fetchGameArt` returns the full `EmbedGame`, which satisfies this.
 */
export interface GroupGameArt {
  coverUrl?: string | null;
  badges?: GameBadgeInputs | null;
}

/**
 * Read cover art and badge inputs for the games a room is on.
 *
 * Uses `QUICK_PLAY_GAME_COLUMNS` so the badge shape is byte-identical to the
 * one ROK-1447's evented card renders — a short group and an evented group of
 * the same title must not disagree about whether it is co-op or on sale.
 *
 * @param db - Drizzle handle.
 * @param ids - Game ids present in the room; duplicates and nulls are the
 *   caller's to strip, but a repeated id costs nothing.
 * @returns gameId → projected game. Ids with no row are simply absent, which
 *   the caller renders as "no art" rather than a placeholder.
 */
export async function fetchGameArt(
  db: PostgresJsDatabase<typeof schema>,
  ids: readonly number[],
): Promise<Map<number, EmbedGame>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select(QUICK_PLAY_GAME_COLUMNS)
    .from(schema.games)
    .where(inArray(schema.games.id, unique));
  const art = new Map<number, EmbedGame>();
  for (const row of rows as QuickPlayGameRow[]) {
    const game = toQuickPlayGame(row);
    if (game) art.set(row.id, game);
  }
  return art;
}
