import type { Channel, NotificationType } from '../../hooks/use-notifications';

/** Metadata for one notification-type row on `/profile/notifications`. */
export interface NotificationTypeMeta {
    type: NotificationType;
    label: string;
    description: string;
}

/** A sub-heading inside the notification matrix and the rows under it (ROK-2311). */
export interface NotificationTypeGroup {
    heading: string;
    rows: readonly NotificationTypeMeta[];
}

/**
 * ROK-2311 — rows whose notice never leaves the bell (no Discord DM, no push).
 * Their row hides the Discord switch, so the caption can never read "Discord DM only".
 */
export const IN_APP_ONLY_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(['lineup_lfg_offer']);

/**
 * ROK-2311 — the inverse: rows whose notice is only ever a Discord DM (never the bell, never pushed).
 * Their row hides the bell switch and keeps only Discord.
 */
export const DM_ONLY_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(['valheim_claim_suggestion']);

/** The channels a row offers, out of the channels the member can see. */
export function rowChannels<T extends { channel: Channel }>(type: NotificationType, visible: readonly T[]): T[] {
    if (IN_APP_ONLY_TYPES.has(type)) return visible.filter(({ channel }) => channel === 'inApp');
    if (DM_ONLY_TYPES.has(type)) return visible.filter(({ channel }) => channel === 'discord');
    return [...visible];
}

const EVENTS: NotificationTypeGroup = {
    heading: 'Events',
    rows: [
        { type: 'event_reminder', label: 'Event Reminders', description: 'Reminders for upcoming events' },
        // ROK-2311 Q1/Q2 — `new_event` has no sender except invites (member + character), so the row is "Event invites".
        { type: 'new_event', label: 'Event invites', description: 'Someone invites you or one of your characters to an event' },
        { type: 'event_cancelled', label: 'Event Cancelled', description: 'When an event you signed up for is cancelled' },
        { type: 'event_rescheduled', label: 'Event Rescheduled', description: 'When an event you signed up for is rescheduled' },
        { type: 'event_delayed', label: 'Event delayed', description: 'The organizer pushes the start time back' },
        { type: 'running_late', label: 'Running late', description: 'Someone on the roster says they are running late' },
        {
            type: 'post_event_followup',
            label: 'Post-Event Follow-Ups',
            description: 'Prompts to schedule a follow-up and quick sign-up invites after an event ends',
        },
    ],
};

const ROSTER_SPOT: NotificationTypeGroup = {
    heading: 'Your roster spot',
    rows: [
        { type: 'bench_promoted', label: 'Bench Promoted', description: 'When you are moved from bench to the active roster' },
        { type: 'roster_reassigned', label: 'Roster Reassignment', description: 'When your roster slot or role is changed' },
        { type: 'voice_access_lost', label: 'Voice access removed', description: 'You lose access to an event’s private voice channel' },
        { type: 'tentative_displaced', label: 'Tentative Displaced', description: 'When a confirmed player takes your tentative slot' },
    ],
};

const ORGANIZER: NotificationTypeGroup = {
    heading: 'Organizer',
    rows: [
        { type: 'slot_vacated', label: 'Slot Vacated', description: 'When someone leaves a roster slot' },
        { type: 'missed_event_nudge', label: 'No-show alerts', description: 'Someone signed up has not joined 5 minutes after start' },
        { type: 'recruitment_reminder', label: 'Spots available', description: 'Your event still has open spots' },
        { type: 'role_gap_alert', label: 'Role gaps', description: 'Your event starts soon and still needs roles filled' },
        { type: 'member_returned', label: 'Member Returned', description: 'When a departed member rejoins a live event' },
    ],
};

const GAMES_AND_GROUPS: NotificationTypeGroup = {
    heading: 'Games & groups',
    rows: [
        { type: 'subscribed_game', label: 'Subscribed Games', description: 'Activity for games you follow' },
        { type: 'hub_leader_post', label: 'Group posts', description: 'A leader posts an update in a group you belong to' },
        { type: 'hub_event_tagged', label: 'Group events', description: 'An event is tagged to a group you belong to' },
        { type: 'hub_proposal_submitted', label: 'Hub proposals', description: 'Someone proposes a new community hub for review (staff)' },
        { type: 'hub_proposal_reviewed', label: 'Hub proposal decisions', description: 'Your community hub proposal is approved or rejected' },
        // ROK-1933 — the suggested-match DM; its footer links #notif-valheim_claim_suggestion.
        {
            type: 'valheim_claim_suggestion',
            label: 'Character claim suggestions',
            description: 'A Discord DM when a Valheim character on a server looks like yours',
        },
    ],
};

const LINEUPS_AND_POLLS: NotificationTypeGroup = {
    heading: 'Lineups & polls',
    rows: [
        { type: 'community_lineup', label: 'Community Lineup', description: 'Lineup nominations, voting, ties and matches' },
        { type: 'scheduling_poll', label: 'Scheduling polls', description: 'A poll to pick a time, its reminders and results' },
        { type: 'lineup_lfg_offer', label: 'LFG offers after a lineup', description: 'Offers to find a group for a game that did not win' },
        { type: 'lineup_steam_nudge', label: 'Steam link nudges', description: 'A reminder to link your Steam account for a lineup' },
    ],
};

const LFG: NotificationTypeGroup = {
    heading: 'LFG',
    rows: [
        { type: 'lfg_invite', label: 'LFG group forming', description: 'A group is forming for a game you subscribe to' },
        { type: 'lfg_player_invite', label: 'LFG player invites', description: 'A player invites you to join their group for a game' },
    ],
};

const OTHER: NotificationTypeGroup = {
    heading: 'Other',
    rows: [
        { type: 'gg_ready', label: 'Your GG of the year', description: 'When your yearly GG story is ready to open' },
        // ROK-1866 — the one-per-episode reconnect nudge.
        {
            type: 'calendar_needs_reconnect',
            label: 'Calendar needs reconnecting',
            description: 'When a connected calendar stops syncing and needs you to reconnect it',
        },
    ],
};

/** The matrix, in page order: seven headings, as approved in the ROK-2311 mockup. */
export const NOTIFICATION_TYPE_GROUPS: readonly NotificationTypeGroup[] = [
    EVENTS, ROSTER_SPOT, ORGANIZER, GAMES_AND_GROUPS, LINEUPS_AND_POLLS, LFG, OTHER,
];

/** Every row, flattened in page order. */
export const NOTIFICATION_TYPE_META: readonly NotificationTypeMeta[] = NOTIFICATION_TYPE_GROUPS.flatMap((g) => g.rows);
