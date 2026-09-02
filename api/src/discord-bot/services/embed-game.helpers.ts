/**
 * ROK-1460 (slice B) — the games-row → embed projection.
 *
 * The event embed's title links to the game detail page (`/games/:id`), so the
 * id has to travel with the name and the cover art. Every hydration site goes
 * through here so none of them can drop it again. See
 * `planning-artifacts/specs/ROK-1460.md` §Files, §Links.
 */
import * as schema from '../../drizzle/schema';
import type { GameBadgeInputs } from '../embeds/embed-badges.helpers';
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

/**
 * ROK-1447 — the extra columns the Quick Play badges read.
 *
 * Deliberately NOT folded into `EMBED_GAME_COLUMNS`: the four scheduled-event
 * hydration sites render no badges, and widening their projection would make
 * every 5s embed re-sync read ten columns nobody looks at.
 */
export const EMBED_GAME_BADGE_COLUMNS = {
  isFreeToPlay: schema.games.isFreeToPlay,
  itadCurrentPrice: schema.games.itadCurrentPrice,
  itadCurrentCut: schema.games.itadCurrentCut,
  itadCurrentShop: schema.games.itadCurrentShop,
  itadCurrentUrl: schema.games.itadCurrentUrl,
  itadLowestPrice: schema.games.itadLowestPrice,
  itadPriceUpdatedAt: schema.games.itadPriceUpdatedAt,
  cooptimusOnlineMax: schema.games.cooptimusOnlineMax,
  cooptimusCouchMax: schema.games.cooptimusCouchMax,
  cooptimusComboCoop: schema.games.cooptimusComboCoop,
} as const;

/** Drizzle column map for a `select` that feeds `toQuickPlayGame`. */
export const QUICK_PLAY_GAME_COLUMNS = {
  ...EMBED_GAME_COLUMNS,
  ...EMBED_GAME_BADGE_COLUMNS,
} as const;

/** One games row as the Quick Play projection selects it. */
export type QuickPlayGameRow = GameRow & GameBadgeInputs;

/** Copy the badge columns off the row, nulls and all. */
function toBadgeInputs(row: QuickPlayGameRow): GameBadgeInputs {
  return {
    isFreeToPlay: row.isFreeToPlay,
    // `numeric` arrives as a STRING; rounding it here would lose the 2dp the
    // badge renders, so it travels verbatim.
    itadCurrentPrice: row.itadCurrentPrice,
    itadCurrentCut: row.itadCurrentCut,
    itadCurrentShop: row.itadCurrentShop,
    itadCurrentUrl: row.itadCurrentUrl,
    itadLowestPrice: row.itadLowestPrice,
    itadPriceUpdatedAt: row.itadPriceUpdatedAt,
    cooptimusOnlineMax: row.cooptimusOnlineMax,
    cooptimusCouchMax: row.cooptimusCouchMax,
    cooptimusComboCoop: row.cooptimusComboCoop,
  };
}

/**
 * Project a games row onto the embed's view of it, badges included.
 *
 * @param row - The selected games row, or null/undefined for a gameless event.
 * @returns `{ id, name, coverUrl, badges }`, or null when there is no game.
 */
export function toQuickPlayGame(
  row: QuickPlayGameRow | null | undefined,
): EmbedGame | null {
  const game = toEmbedGame(row);
  if (!game || !row) return null;
  return { ...game, badges: toBadgeInputs(row) };
}
