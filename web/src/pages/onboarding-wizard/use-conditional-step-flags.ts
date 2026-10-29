import { useMemo } from 'react';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useGuildMembership } from '../../hooks/use-discord-onboarding';
import { useSteamLink } from '../../hooks/use-steam-link';
import { isDiscordLinked } from '../../lib/avatar';
import { useCalendarStepFlag } from './use-calendar-step-flag';

export interface ConditionalStepFlags {
    needsConnect: boolean;
    needsDiscordJoin: boolean;
    needsSteamConnect: boolean;
    /** ROK-2022: the Calendar step (after Game Time); see `useCalendarStepFlag`. */
    needsCalendarConnect: boolean;
    /**
     * Tech-debt [12]: false until every query that can insert a step BEFORE
     * Games has answered (system status → Connect/Steam, Steam status → Steam).
     * The wizard's position is an index, so a step inserted after the first
     * render shifts it — the page waits for this instead of rendering early.
     * ROK-2022: with `resumeCalendar` it also waits for the calendars overview,
     * because the resume seek needs the final step list.
     */
    settled: boolean;
}

export interface ConditionalStepOptions {
    /** `?resume=calendar` — the Google OAuth return re-opens the Calendar step (ROK-2022). */
    resumeCalendar?: boolean;
}

/** Determines which conditional steps are needed based on user/discord/steam/calendar state */
export function useConditionalStepFlags(
    user: { discordId: string } | null,
    { resumeCalendar = false }: ConditionalStepOptions = {},
): ConditionalStepFlags {
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

    const calendar = useCalendarStepFlag(resumeCalendar);

    // `isLoading` (not `isPending`): a disabled Steam query (no token) is settled.
    const settled = !systemLoading && !(steamConfigured && steamStatus.isLoading) && calendar.settled;
    return { needsConnect, needsDiscordJoin, needsSteamConnect, needsCalendarConnect: calendar.needsCalendarConnect, settled };
}
