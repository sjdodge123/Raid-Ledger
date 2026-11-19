/**
 * ROK-2259 — re-attributes a game-activity session the registry resolved to
 * `gameId` to the game the player actually plays (Discord reports several
 * clients under one activity name). Returns `gameId` when it does not apply.
 */
export interface GameActivityAttributionAdapter {
  /**
   * `null` credits no game (e.g. a presence row duplicating an open voice row
   * of the same play); later adapters are then skipped.
   */
  attribute(
    userId: number,
    gameId: number,
    discordActivityName: string,
  ): Promise<number | null>;
  /**
   * Optional: the game to credit for a session whose raw Discord name resolved
   * to no game (e.g. "World of Warcraft Classic" without a mapping row), or
   * `null` when the adapter does not recognise the name.
   */
  attributeUnresolved?(
    userId: number,
    discordActivityName: string,
  ): Promise<number | null>;
}
