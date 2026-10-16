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
