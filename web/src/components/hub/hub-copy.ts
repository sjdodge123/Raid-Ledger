/**
 * ROK-1831 — the core hub widgets' kind-aware copy. A WoW guild talks about a
 * guild master and raids; a game-server hub has a server leader and sessions.
 * Components read their strings from here (one map per kind) instead of
 * forking copy inline — the same shape as the setup checklist's SERVER_COPY.
 */
import type { GuildKind } from '@raid-ledger/contract';

export interface HubCopy {
    leaderPostPill: string;
    leaderPostHeading: string;
    leaderPostEmpty: string;
    scheduleTitle: string;
    scheduleEmpty: string;
    attendanceEmpty: string;
    editorsEmpty: string;
    /** Events card empty states (ROK-1870: a community hub has no "guild"). */
    upcomingEmpty: string;
    recentEmpty: string;
    /** The settings trigger + sheet title (ROK-1870: a community hub is not a guild). */
    settingsTitle: string;
}

const WOW_COPY: HubCopy = {
    leaderPostPill: 'From the guild master',
    leaderPostHeading: 'Message from the guild master',
    leaderPostEmpty: 'No post from the guild master yet.',
    scheduleTitle: 'Weekly raid schedule',
    scheduleEmpty: 'No recurring raids yet. A guild editor can pick this guild when creating a repeating event.',
    attendanceEmpty: "No attendance recorded yet. It fills in once a guild raid's attendance is taken.",
    editorsEmpty: 'No one yet. Add a rank or a member below — start with your Guild Master.',
    upcomingEmpty: 'No upcoming guild events. A guild editor can pick this guild when creating an event.',
    recentEmpty: 'No guild events in the last 8 weeks.',
    settingsTitle: 'Guild settings',
};

const SERVER_COPY: HubCopy = {
    leaderPostPill: 'From the server leader',
    leaderPostHeading: 'Message from the server leader',
    leaderPostEmpty: 'No post from the server leader yet.',
    scheduleTitle: 'Upcoming sessions',
    scheduleEmpty: 'No sessions scheduled yet.',
    attendanceEmpty: "No attendance recorded yet. It fills in once a session's attendance is taken.",
    editorsEmpty: 'No one yet — start with your server leader.',
    upcomingEmpty: 'No upcoming guild events. A guild editor can pick this guild when creating an event.',
    recentEmpty: 'No guild events in the last 8 weeks.',
    settingsTitle: 'Guild settings',
};

/** ROK-1870 — a community hub has a leader (the approved proposer) and sessions, no server. */
const COMMUNITY_COPY: HubCopy = {
    leaderPostPill: 'From the hub leader',
    leaderPostHeading: 'Message from the hub leader',
    leaderPostEmpty: 'No post from the hub leader yet.',
    scheduleTitle: 'Upcoming sessions',
    scheduleEmpty: 'No sessions scheduled yet.',
    attendanceEmpty: "No attendance recorded yet. It fills in once a session's attendance is taken.",
    editorsEmpty: 'No one yet — start with your hub leader.',
    upcomingEmpty: 'No upcoming hub events. A hub editor can pick this hub when creating an event.',
    recentEmpty: 'No hub events in the last 8 weeks.',
    settingsTitle: 'Hub settings',
};

export const HUB_COPY: Readonly<Record<GuildKind, HubCopy>> = {
    wow_guild: WOW_COPY,
    game_server: SERVER_COPY,
    game_community: COMMUNITY_COPY,
};

/** Copy for a hub kind; an unknown/absent kind reads as a WoW guild (the pre-ROK-1831 default). */
export function hubCopy(kind: GuildKind | undefined): HubCopy {
    return HUB_COPY[kind ?? 'wow_guild'];
}
