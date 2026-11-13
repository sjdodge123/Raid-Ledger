/**
 * ROK-1789 — the guild recruitment endpoints (`/plugins/wow/guilds/:id/recruitment`).
 * Kept out of `api-client.ts` (near its line cap) and loaded by dynamic import
 * from the hook, so the eager probe and header action never pull the schema.
 */
import {
    GuildRecruitmentViewSchema,
    type GuildRecruitmentView,
    type PutGuildRecruitmentInput,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';

const recruitmentPath = (guildId: number): string => `/plugins/wow/guilds/${guildId}/recruitment`;

/** Members + staff read the view; a non-member gets 403, an unknown guild 404. */
export async function fetchGuildRecruitment(guildId: number): Promise<GuildRecruitmentView> {
    return fetchApi(recruitmentPath(guildId), {}, GuildRecruitmentViewSchema);
}

/** Editors and the rank-0 GM replace the whole object (last write wins, A-D4); returns the new view. */
export async function putGuildRecruitment(guildId: number, body: PutGuildRecruitmentInput): Promise<GuildRecruitmentView> {
    return fetchApi(recruitmentPath(guildId), { method: 'PUT', body: JSON.stringify(body) }, GuildRecruitmentViewSchema);
}

/** Editors and the rank-0 GM clear it back to unset (204). */
export async function deleteGuildRecruitment(guildId: number): Promise<void> {
    await fetchApi<void>(recruitmentPath(guildId), { method: 'DELETE' });
}
