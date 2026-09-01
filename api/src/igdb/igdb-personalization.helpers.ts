/**
 * ROK-1314 — viewer personalization for the `GameDetailDto` routes
 * (`GET /games/search`, `/games/discover`, `/games/:id`).
 *
 * Those routes are public and carry an `OptionalJwtGuard`, so the viewer may
 * be absent. Spec §4.5: anonymous ⇒ both flags explicitly `false`, never
 * `undefined`, never a 401. The lookup is skipped entirely when there is no
 * viewer, and is a single batched read otherwise (no N+1).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  loadViewerInterests,
  viewerFlagsFor,
} from '../lineups/viewer-interests.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The `req.user` shape an `OptionalJwtGuard`-protected route receives. */
export interface OptionalViewer {
  user?: { id: number } | null;
}

/** Read the viewer id off an optionally-authenticated request. */
export function viewerIdOf(req: OptionalViewer | undefined): number | null {
  return req?.user?.id ?? null;
}

/**
 * Overlay `currentUserOwns` / `currentUserWishlisted` onto a flat list of
 * game DTOs. Returns copies; the input is not mutated. When `viewerId` is
 * null the DTOs are returned untouched — `mapDbRowToDetail` already seeds
 * both flags to `false`.
 */
export async function personalizeGames<T extends GameDetailDto>(
  db: Db,
  viewerId: number | null,
  games: T[],
): Promise<T[]> {
  if (viewerId == null || games.length === 0) return games;
  const map = await loadViewerInterests(
    db,
    viewerId,
    games.map((g) => g.id),
  );
  return games.map((g) => ({ ...g, ...viewerFlagsFor(map, g.id) }));
}

/**
 * Overlay viewer flags across every game in every discover row with ONE
 * batched lookup spanning all rows (rows share games, so per-row queries
 * would be both an N+1 and redundant).
 */
export async function personalizeDiscoverRows(
  db: Db,
  viewerId: number | null,
  rows: GameDiscoverRowDto[],
): Promise<GameDiscoverRowDto[]> {
  if (viewerId == null || rows.length === 0) return rows;
  const gameIds = [...new Set(rows.flatMap((r) => r.games.map((g) => g.id)))];
  const map = await loadViewerInterests(db, viewerId, gameIds);
  return rows.map((row) => ({
    ...row,
    games: row.games.map((g) => ({ ...g, ...viewerFlagsFor(map, g.id) })),
  }));
}
