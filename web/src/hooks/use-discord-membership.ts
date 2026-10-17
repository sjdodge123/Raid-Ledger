import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import { getAuthToken } from './use-auth';
import type { DiscordMembershipResponseDto } from '@raid-ledger/contract';

/**
 * ROK-425: Check if current user is a member of the bot's Discord guild.
 * Used by the Discord join banner.
 * Stale time is 1 hour to avoid spamming the Discord API.
 */
export function useDiscordMembership() {
    return useQuery({
        queryKey: ['discord-membership'],
        queryFn: () =>
            fetchApi<DiscordMembershipResponseDto>('/users/me/discord-membership'),
        staleTime: 60 * 60 * 1000, // 1 hour
        enabled: !!getAuthToken(),
    });
}
