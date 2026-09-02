/**
 * ROK-1460 (slice B) — the games-row → embed projection.
 *
 * The event embed's title links to the game detail page (`/games/:id`), so the
 * id has to travel with the name and the cover art. Every hydration site goes
 * through here so none of them can drop it again. See
 * `planning-artifacts/specs/ROK-1460.md` §Files, §Links.
 */
import * as schema from '../../drizzle/schema';
import type { EmbedEventData } from './discord-embed.factory';

/** The game shape an embed consumes. */
export type EmbedGame = NonNullable<EmbedEventData['game']>;

/** One games row, as any of the hydration sites selects it. */
export interface GameRow {
  id: number;
  name: string;
  coverUrl?: string | null;
}

/** Drizzle column map for a `select` that feeds `toEmbedGame`. */
export const EMBED_GAME_COLUMNS = {
  id: schema.games.id,
  name: schema.games.name,
  coverUrl: schema.games.coverUrl,
} as const;

/**
 * Project a games row onto the embed's view of it.
 *
 * @param row - The selected games row, or null/undefined for a gameless event.
 * @returns `{ id, name, coverUrl }`, or null when there is no game.
 */
export function toEmbedGame(row: GameRow | null | undefined): EmbedGame | null {
  if (!row) return null;
  return { id: row.id, name: row.name, coverUrl: row.coverUrl ?? null };
}
