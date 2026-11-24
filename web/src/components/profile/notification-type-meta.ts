import type { NotificationType } from '../../hooks/use-notifications';

/** Metadata for each notification type row */
export const NOTIFICATION_TYPE_META: {
    type: NotificationType;
    label: string;
    description: string;
}[] = [
    {
        type: 'slot_vacated',
        label: 'Slot Vacated',
        description: 'When someone leaves a roster slot',
    },
    {
        type: 'member_returned',
        label: 'Member Returned',
        description: 'When a departed member rejoins a live event',
    },
    {
        type: 'event_reminder',
        label: 'Event Reminders',
        description: 'Reminders for upcoming events',
    },
    {
        type: 'new_event',
        label: 'New Events',
        description: 'When new events are created',
    },
    {
        type: 'subscribed_game',
        label: 'Subscribed Games',
        description: 'Activity for games you follow',
    },
    {
        type: 'hub_leader_post',
        label: 'Group posts',
        description: 'A leader posts an update in a group you belong to',
    },
    {
        type: 'hub_event_tagged',
        label: 'Group events',
        description: 'An event is tagged to a group you belong to',
    },
    {
        type: 'hub_proposal_submitted',
        label: 'Hub proposals',
        description: 'Someone proposes a new community hub for review (staff)',
    },
    {
        type: 'hub_proposal_reviewed',
        label: 'Hub proposal decisions',
        description: 'Your community hub proposal is approved or rejected',
    },
    {
        type: 'event_cancelled',
        label: 'Event Cancelled',
        description: 'When an event you signed up for is cancelled',
    },
    {
        type: 'event_rescheduled',
        label: 'Event Rescheduled',
        description: 'When an event you signed up for is rescheduled',
    },
    {
        type: 'bench_promoted',
        label: 'Bench Promoted',
        description: 'When you are moved from bench to the active roster',
    },
    {
        type: 'roster_reassigned',
        label: 'Roster Reassignment',
        description: 'When your roster slot or role is changed',
    },
    {
        type: 'tentative_displaced',
        label: 'Tentative Displaced',
        description: 'When a confirmed player takes your tentative slot',
    },
    {
        type: 'gg_ready',
        label: 'Your GG of the year',
        description: 'When your yearly GG story is ready to open',
    },
    {
        // ROK-1866 — the one-per-episode reconnect nudge.
        type: 'calendar_needs_reconnect',
        label: 'Calendar needs reconnecting',
        description: 'When a connected calendar stops syncing and needs you to reconnect it',
    },
    {
        type: 'community_lineup',
        label: 'Community Lineup',
        description: 'Updates about community lineup voting, matches, and scheduling',
    },
    {
        type: 'post_event_followup',
        label: 'Post-Event Follow-Ups',
        description: 'Prompts to schedule a follow-up and quick sign-up invites after an event ends',
    },
    {
        type: 'lfg_invite',
        label: 'LFG group forming',
        description: 'A group is forming for a game you subscribe to',
    },
    {
        type: 'lfg_player_invite',
        label: 'LFG player invites',
        description: 'A player invites you to join their group for a game',
    },
    {
        // ROK-1933 — the suggested-match DM; its footer links #notif-valheim_claim_suggestion.
        type: 'valheim_claim_suggestion',
        label: 'Character claim suggestions',
        description: 'A Discord DM when a Valheim character on a server looks like yours',
    },
];
