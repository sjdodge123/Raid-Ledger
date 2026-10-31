/**
 * ROK-1703 D-2 — the Discord wizard step's sub-screen is DERIVED from what the
 * server has saved, never stored: nothing saved → 4a; keys partly saved → 4c;
 * OAuth + token saved but the bot is not in a server → 4d; joined → 4e.
 * 4a/4b have no server signal and are reachable by Back or the rail only.
 */
import { useQuery } from '@tanstack/react-query';
import type { DiscordBotStatusResponse, DiscordSetupStatus } from '@raid-ledger/contract';
import { adminFetch } from '../../../../hooks/admin/admin-fetch';
import { getAuthToken } from '../../../../hooks/use-auth';

export type DiscordSubstep = 'create' | 'links' | 'keys' | 'invite' | 'joined';

export const DISCORD_SUBSTEPS: readonly { key: DiscordSubstep; label: string }[] = [
    { key: 'create', label: 'Create the app' },
    { key: 'links', label: 'Sign-in links' },
    { key: 'keys', label: 'Keys and token' },
    { key: 'invite', label: 'Invite the bot' },
    { key: 'joined', label: 'Bot joined' },
];

export function substepIndex(step: DiscordSubstep): number {
    return DISCORD_SUBSTEPS.findIndex((s) => s.key === step);
}

type BotJoinFacts = Pick<DiscordBotStatusResponse, 'connected' | 'guildName'>;

/** Pure D-2 derivation (table-tested). */
export function deriveSubstep(setup: DiscordSetupStatus | undefined, bot: BotJoinFacts | undefined): DiscordSubstep {
    const done = (key: string): boolean => setup?.steps.some((s) => s.key === key && s.completed) ?? false;
    const oauth = done('oauth');
    const token = done('bot-token');
    if (oauth && token) return bot?.connected && bot.guildName ? 'joined' : 'invite';
    if (oauth || token) return 'keys';
    return 'create';
}

const BOT_KEY = ['admin', 'settings', 'discord-bot'] as const;

/**
 * The two reads the derivation needs. Not plugin-gated (unlike the admin
 * page's setup-status query): the wizard runs before anything is configured.
 */
export function useDerivedDiscordSubstep(): DiscordSubstep | undefined {
    const enabled = !!getAuthToken();
    const setup = useQuery<DiscordSetupStatus>({
        queryKey: [...BOT_KEY, 'setup-status'],
        queryFn: () => adminFetch('/admin/settings/discord-bot/setup-status'),
        enabled,
    });
    const bot = useQuery<DiscordBotStatusResponse>({
        queryKey: [...BOT_KEY],
        queryFn: () => adminFetch('/admin/settings/discord-bot'),
        enabled,
    });
    if (setup.isLoading || bot.isLoading) return undefined;
    return deriveSubstep(setup.data, bot.data);
}
