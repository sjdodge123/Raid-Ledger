/** An event's guild tag and the game it was tagged for. */
export interface EventGuildTagState {
  guildId: number | null;
  gameId: number | null;
}

/**
 * True when moving an event to `nextGameId` would strand its guild tag on a
 * game the guild is not for (GUILD_GAME_MISMATCH). Shared by the web/API edit
 * path (`EventGuildTagService`) and `/bind event:… game:…` (TECH-DEBT L2836).
 */
export function gameChangeStrandsGuildTag(
  tag: EventGuildTagState,
  nextGameId: number | null,
): boolean {
  return tag.guildId !== null && nextGameId !== tag.gameId;
}
