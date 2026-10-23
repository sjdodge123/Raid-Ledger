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
    /** ROK-1868 — leader posts. */
    postsTab: string;
    previousPosts: string;
    composerLabel: string;
    composerHint: string;
    postRemoved: string;
    postsBlurb: string;
    /** Events card empty states (ROK-1870: a community hub has no "guild"). */
    upcomingEmpty: string;
    recentEmpty: string;
    /** The settings trigger + sheet title (ROK-1870: a community hub is not a guild). */
    settingsTitle: string;
    /** ROK-1891 — what the hub is called in running text: "this guild", "this server", "this hub". */
    noun: string;
    /** ROK-1891 — the editor's empty leader-post prompt. */
    leaderPostPrompt: string;
    /** ROK-1891 (operator ruling) — the schedule card renders nothing when it has no series. */
    hideEmptySchedule: boolean;
    /** ROK-1891 — the hero chip's lead-in ("Next raid: Tue 20:00"). */
    nextEventLabel: string;
    /** ROK-1891 — the full Events section heading and blurb. */
    eventsTitle: string;
    eventsBlurb: string;
}

/** ROK-1891 — the schedule card on hubs that are not WoW guilds (operator ruling). */
const REGULAR_SCHEDULE = {
    scheduleTitle: 'Regular schedule',
    scheduleEmpty: 'No repeating sessions yet. Make an event repeat and it shows here.',
    hideEmptySchedule: true,
} as const;

const HUB_PROMPT = 'Share news, plans or a welcome with everyone in the hub.';

const WOW_COPY: HubCopy = {
    leaderPostPill: 'From the guild master',
    leaderPostHeading: 'Message from the guild master',
    leaderPostEmpty: 'No post from the guild master yet.',
    scheduleTitle: 'Weekly raid schedule',
    scheduleEmpty: 'No recurring raids yet. A guild editor can pick this guild when creating a repeating event.',
    attendanceEmpty: "No attendance recorded yet. It fills in once a guild raid's attendance is taken.",
    editorsEmpty: 'No one yet. Add a rank or a member below — start with your Guild Master.',
    postsTab: 'Posts',
    previousPosts: 'Previous posts',
    composerLabel: 'New post',
    composerHint: 'Members see this at the top of the guild page.',
    postRemoved: 'This post was removed.',
    postsBlurb: 'Everything the guild master and officers have posted, newest first.',
    upcomingEmpty: 'No upcoming guild events. A guild editor can pick this guild when creating an event.',
    recentEmpty: 'No guild events in the last 8 weeks.',
    settingsTitle: 'Guild settings',
    noun: 'guild',
    leaderPostPrompt: 'Share news, plans or a welcome with everyone here.',
    hideEmptySchedule: false,
    nextEventLabel: 'Next raid',
    eventsTitle: 'Guild events',
    eventsBlurb: 'Raids and runs scheduled for this guild.',
};

const SERVER_COPY: HubCopy = {
    leaderPostPill: 'From the server leader',
    leaderPostHeading: 'Message from the server leader',
    leaderPostEmpty: 'No post from the server leader yet.',
    ...REGULAR_SCHEDULE,
    attendanceEmpty: "No attendance recorded yet. It fills in once a session's attendance is taken.",
    editorsEmpty: 'No one yet — start with your server leader.',
    postsTab: 'Posts',
    previousPosts: 'Previous posts',
    composerLabel: 'New post',
    composerHint: 'Members see this at the top of the server page.',
    postRemoved: 'This post was removed.',
    postsBlurb: 'Everything the server leader and officers have posted, newest first.',
    upcomingEmpty: 'No upcoming server events. A server editor can pick this server when creating an event.',
    recentEmpty: 'No server events in the last 8 weeks.',
    settingsTitle: 'Server settings',
    noun: 'server',
    leaderPostPrompt: HUB_PROMPT,
    nextEventLabel: 'Next event',
    eventsTitle: 'Server events',
    eventsBlurb: 'Sessions and events scheduled for this server.',
};

/** ROK-1870 — a community hub has a leader (the approved proposer) and sessions, no server. */
const COMMUNITY_COPY: HubCopy = {
    leaderPostPill: 'From the hub leader',
    leaderPostHeading: 'Message from the hub leader',
    leaderPostEmpty: 'No post from the hub leader yet.',
    ...REGULAR_SCHEDULE,
    attendanceEmpty: "No attendance recorded yet. It fills in once a session's attendance is taken.",
    editorsEmpty: 'No one yet — start with your hub leader.',
    postsTab: 'Posts',
    previousPosts: 'Previous posts',
    composerLabel: 'New post',
    composerHint: 'Members see this at the top of the hub page.',
    postRemoved: 'This post was removed.',
    postsBlurb: 'Everything the hub leader and editors have posted, newest first.',
    upcomingEmpty: 'No upcoming hub events. A hub editor can pick this hub when creating an event.',
    recentEmpty: 'No hub events in the last 8 weeks.',
    settingsTitle: 'Hub settings',
    noun: 'hub',
    leaderPostPrompt: HUB_PROMPT,
    nextEventLabel: 'Next event',
    eventsTitle: 'Hub events',
    eventsBlurb: 'Sessions and events scheduled for this hub.',
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
