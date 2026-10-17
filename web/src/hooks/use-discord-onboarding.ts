import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api-client';
import type {
  ServerInviteResponseDto,
  GuildMembershipResponseDto,
} from '@raid-ledger/contract';

/**
 * Hook for fetching a Discord server invite URL (ROK-403).
 * Used by the FTE "Join Discord" wizard step.
 */
export function useServerInvite(enabled = true) {
  return useQuery<ServerInviteResponseDto>({
    queryKey: ['discord', 'server-invite'],
    queryFn: () => fetchApi<ServerInviteResponseDto>('/discord/server-invite'),
    enabled,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

/**
 * Hook for checking if the current user is already in the Discord server (ROK-403).
 * Used to auto-skip the "Join Discord" step in the FTE wizard.
 */
export function useGuildMembership(enabled = true) {
  return useQuery<GuildMembershipResponseDto>({
    queryKey: ['discord', 'guild-membership'],
    queryFn: () =>
      fetchApi<GuildMembershipResponseDto>('/discord/guild-membership'),
    enabled,
    staleTime: 30 * 1000, // Cache for 30 seconds
  });
}
