/**
 * ROK-1817 — "Schedule for guild": the Create Event deep link for one guild.
 * `/events/new` preselects the game from `gameId` and the guild from `guildId`
 * (ROK-1893 P3); the server still re-checks that the creator may tag it.
 */
export function scheduleForGuildUrl(guild: { id: number; gameId: number }): string {
    const params = new URLSearchParams({ gameId: String(guild.gameId), guildId: String(guild.id) });
    return `/events/new?${params.toString()}`;
}
