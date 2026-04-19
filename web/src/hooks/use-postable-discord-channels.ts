/**
 * TanStack Query hook for the operator-scoped postable-channel picker
 * (ROK-1064). Fetches `GET /discord/channels?permissions=postable`.
 *
 * On error or empty result, the caller is expected to hide the picker
 * (feature unavailable) and fall back to the guild-bound default.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DiscordChannelListResponseDto } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';

const QUERY_KEY = ['discord', 'channels', 'postable'] as const;

/** Query hook returning `{ id, name }[]` for channels the bot can post to. */
export function usePostableDiscordChannels(
  enabled = true,
): UseQueryResult<DiscordChannelListResponseDto> {
  return useQuery<DiscordChannelListResponseDto>({
    queryKey: [...QUERY_KEY],
    queryFn: () =>
      fetchApi<DiscordChannelListResponseDto>(
        '/discord/channels?permissions=postable',
      ),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
}
