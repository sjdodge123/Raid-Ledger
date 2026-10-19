/**
 * MSW handler for the guild Raids read API (ROK-1787). Default: a guild with
 * no tagged events — every widget shows its empty state and the hero has no
 * "Next raid" chip. Specs that need data override with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import type { GuildRaidsDto } from '@raid-ledger/contract';

export const GUILD_RAIDS_URL = 'http://localhost:3000/guilds/:id/raids';

export const emptyGuildRaids: GuildRaidsDto = {
    upcoming: [],
    recent: [],
    schedule: [],
    composition: null,
    attendance: { windowWeeks: 8, rows: [] },
    nextRaid: null,
};

export const guildRaidsHandlers = [
    http.get(GUILD_RAIDS_URL, () => HttpResponse.json(emptyGuildRaids)),
];
