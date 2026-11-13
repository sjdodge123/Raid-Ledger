/**
 * ROK-1789 Part B — the guild Progression page endpoint
 * (`GET /plugins/wow/guilds/:id/progression`): per-instance boss progress plus
 * the 30-day activity feed in one response. Members + staff only (403 otherwise).
 */
import { WowGuildProgressionPageSchema, type WowGuildProgressionPageDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';

const progressionPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/progression`;

/** Fetch and validate one guild's Progression page. */
export async function fetchGuildProgression(guildId: number): Promise<WowGuildProgressionPageDto> {
    return fetchApi(progressionPath(guildId), {}, WowGuildProgressionPageSchema);
}
