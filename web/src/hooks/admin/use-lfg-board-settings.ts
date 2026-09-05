/**
 * ROK-1471: LFG forum-board settings + bot invite metadata.
 *
 * Kept in its own module because `use-discord-bot-settings.ts` is already at the
 * 300-line file cap; these queries follow the same key/adminFetch conventions.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';
// The response shapes are the contract's, not web's: a reshape of
// `warning.missing` in `packages/contract` must break THIS file's build rather
// than silently stop rendering the missing-permission list (AC12).
import type {
    BotInviteInfo,
    LfgBoardSettingsResponse,
} from '@raid-ledger/contract';

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;

/** Query key for the bot invite URL + required-permission list. */
export const BOT_INVITE_KEY = [...BOT_KEY, 'invite-url'] as const;

/** Query key for the LFG board feature toggle. */
export const LFG_BOARD_KEY = [...BOT_KEY, 'lfg-board'] as const;

/**
 * Fetches the invite URL and the permission names the bot requires.
 * The permission list is rendered as-is — never hardcoded in the UI.
 */
export function useBotInviteInfo(): UseQueryResult<BotInviteInfo> {
    return useQuery<BotInviteInfo>({
        queryKey: [...BOT_INVITE_KEY],
        queryFn: () => adminFetch('/admin/settings/discord-bot/invite-url'),
        enabled: !!getAuthToken(),
        staleTime: 60_000,
    });
}

export interface LfgBoardSettingsHook {
    status: UseQueryResult<LfgBoardSettingsResponse>;
    update: UseMutationResult<LfgBoardSettingsResponse, Error, { enabled: boolean }>;
}

/**
 * Reads and writes the LFG forum-board toggle. The PUT response is returned to
 * callers so they can surface a missing-permission warning inline.
 */
export function useLfgBoardSettings(): LfgBoardSettingsHook {
    const queryClient = useQueryClient();

    const status = useQuery<LfgBoardSettingsResponse>({
        queryKey: [...LFG_BOARD_KEY],
        queryFn: () => adminFetch('/admin/settings/discord-bot/lfg-board'),
        enabled: !!getAuthToken(),
    });

    const update = useMutation<LfgBoardSettingsResponse, Error, { enabled: boolean }>({
        mutationFn: (data) =>
            adminFetch('/admin/settings/discord-bot/lfg-board', {
                method: 'PUT', body: JSON.stringify(data),
            }, 'Failed to update LFG board setting'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: [...LFG_BOARD_KEY] }),
    });

    return { status, update };
}
