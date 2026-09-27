import { useMemo } from 'react';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useGuildMembership } from '../../hooks/use-discord-onboarding';
import { useSteamLink } from '../../hooks/use-steam-link';
import { isDiscordLinked } from '../../lib/avatar';

export interface ConditionalStepFlags {
    needsConnect: boolean;
    needsDiscordJoin: boolean;
    needsSteamConnect: boolean;
    /**
     * Tech-debt [12]: false until every query that can insert a step BEFORE
     * Games has answered (system status → Connect/Steam, Steam status → Steam).
     * The wizard's position is an index, so a step inserted after the first
     * render shifts it — the page waits for this instead of rendering early.
     */
    settled: boolean;
}

/** Determines which conditional steps are needed based on user/discord/steam state */
export function useConditionalStepFlags(user: { discordId: string } | null): ConditionalStepFlags {
    const { data: systemStatus, isLoading: systemLoading } = useSystemStatus();
    const discordConfigured = systemStatus?.discordConfigured ?? false;

    const needsConnect = useMemo(() => {
        if (!user || !discordConfigured) return false;
        return !isDiscordLinked(user.discordId);
    }, [user, discordConfigured]);

    const { data: guildMembership } = useGuildMembership(
        discordConfigured && !!user && isDiscordLinked(user.discordId),
    );

    const needsDiscordJoin = useMemo(() => {
        if (!discordConfigured || !user || !isDiscordLinked(user.discordId)) return false;
        // Fail open while membership is unknown (loading or errored): a member
        // sees the step flicker away, but a non-member can never race past it.
        // The step is LAST, so its flicker never shifts the current index.
        if (!guildMembership) return true;
        return !guildMembership.isMember;
    }, [discordConfigured, user, guildMembership]);

    const { steamStatus } = useSteamLink();
    const steamConfigured = systemStatus?.steamConfigured ?? false;
    const needsSteamConnect = useMemo(() => {
        if (!steamConfigured || steamStatus.isLoading) return false;
        return steamStatus.data?.linked !== true;
    }, [steamConfigured, steamStatus.isLoading, steamStatus.data?.linked]);

    // `isLoading` (not `isPending`): a disabled Steam query (no token) is settled.
    const settled = !systemLoading && !(steamConfigured && steamStatus.isLoading);
    return { needsConnect, needsDiscordJoin, needsSteamConnect, settled };
}
