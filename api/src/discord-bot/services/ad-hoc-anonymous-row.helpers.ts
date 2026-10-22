/**
 * ROK-1801 Q4 — the anonymous server-player predicate, kept in its own module
 * so specs that mock `ad-hoc-notification.helpers` keep the real rule.
 */

/** A stored participant row's identity columns. */
export type ParticipantIdentity = {
  discordUserId: string | null;
  discordUsername: string;
  steamId: string | null;
};

/**
 * ROK-1801 Q4: ROK-1800 stores an unnamed, unlinked server player with its
 * SteamID64 as `discordUsername`. Such a row must never render by name.
 */
export function isAnonymousServerRow(row: ParticipantIdentity): boolean {
  return (
    row.discordUserId === null &&
    row.steamId !== null &&
    row.discordUsername === row.steamId
  );
}

/**
 * ` · on server` — ROK-1888 ruling 2: the Quick Play card's label for an
 * unlinked server player, who is not counted there. Lives here (no imports)
 * so a spec mocking the roster helpers keeps the real copy.
 */
export const UNLINKED_SERVER_SUFFIX = ' \u00B7 on server';

/** The identity columns the ROK-1888 predicates read. */
export type LinkIdentity = {
  userId: number | null;
  discordUserId: string | null;
  steamId: string | null;
};

/**
 * ROK-1888 ruling 2: a game-server player tied to no Raid Ledger user and no
 * Discord account (`source='steam'`). The Quick Play card labels it
 * ` · on server` and leaves it out of "N signed up" / "N playing". It still
 * counts toward `minPlayers` (ruling 1) — the lobby threshold never reads
 * this. A Steam row with `userId` set is a separate, real person and counts.
 */
export function isUnlinkedServerRow(row: LinkIdentity): boolean {
  return (
    row.discordUserId === null && row.userId === null && row.steamId !== null
  );
}

/**
 * ROK-1888 OQ4: a voice member with no Raid Ledger account. The card shows
 * the "Join Raid Ledger" hint while at least one is present.
 */
export function isDiscordOnlyRow(row: LinkIdentity): boolean {
  return row.discordUserId !== null && row.userId === null;
}
