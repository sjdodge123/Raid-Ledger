import { useQuery } from '@tanstack/react-query';
import { WowRosterMemberResponseSchema, type WowRosterMemberResponseDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api-client';
import { httpStatusOf } from '../lib/api/api-error';
import { ROSTER_MEMBER_PLUGIN } from '../lib/roster-member-plugin';
import { isSlugActive, usePluginStore } from '../stores/plugin-store';

/** ROK-2149: the read-only character payload of one hub roster member (key shared by the claim CTA). */
export function rosterMemberCharacterKey(hubId: string | undefined, memberId: string | undefined): readonly unknown[] {
    return ['wow-guild-member', hubId ?? null, memberId ?? null];
}

/**
 * ROK-2149 — `GET /plugins/wow/guilds/:id/members/:memberId`. Either a
 * `CharacterDto`-shaped read-only payload (never a real character id) or
 * `{ claimedCharacterId }` when a character now claims the member.
 * 403/404 are final answers, so they are not retried. Never requested while
 * the WoW plugin is off (ROK-2360): the endpoint is the plugin's and would 403.
 */
export function useRosterMemberCharacter(hubId: string | undefined, memberId: string | undefined) {
    const wowActive = usePluginStore((s) => isSlugActive(s.activeSlugs, ROSTER_MEMBER_PLUGIN));
    return useQuery<WowRosterMemberResponseDto>({
        queryKey: rosterMemberCharacterKey(hubId, memberId),
        queryFn: () => fetchApi(`/plugins/wow/guilds/${hubId}/members/${memberId}`, {}, WowRosterMemberResponseSchema),
        enabled: !!hubId && !!memberId && wowActive,
        retry: (count, error) => {
            const status = httpStatusOf(error);
            return status !== 403 && status !== 404 && count < 2;
        },
    });
}
