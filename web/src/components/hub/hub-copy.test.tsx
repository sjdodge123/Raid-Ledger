/**
 * ROK-1831 — kind-aware core widget copy, and members-first core widgets that
 * hide on a 403 instead of painting a red error card.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildScheduleNightDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import type { GuildKind } from '@raid-ledger/contract';
import { HUB_COPY, hubCopy, hubSectionsLabel, privateAckLabel, loadFailedLabel, privateTagTitle } from './hub-copy';
import { GuildRules } from './content/guild-rules';
import { LatestPostCard } from './posts/latest-post-card';
import { GuildDiscordMirror } from './discord/guild-discord-mirror';
import { GuildRaidSchedule } from './events/guild-raid-schedule';
import { GuildAttendance } from './events/guild-attendance';
import { HubSettingsTrigger } from './settings/settings-trigger';

const BASE = 'http://localhost:3000/guilds/7';

describe('hubCopy (ROK-1831)', () => {
    it('switches leader, schedule and attendance copy by hub kind', () => {
        expect(hubCopy('game_server').leaderPostPill).toBe('From the server leader');
        expect(hubCopy('game_server').scheduleTitle).toBe('Regular schedule');
        expect(hubCopy('game_server').editorsEmpty).toContain('start with your server leader');
        expect(hubCopy('wow_guild').leaderPostPill).toBe('From the guild master');
        expect(hubCopy(undefined)).toBe(HUB_COPY.wow_guild);
    });

    it('names the settings "Hub settings" on a community hub (ROK-1870)', () => {
        expect(hubCopy('game_community').settingsTitle).toBe('Hub settings');
        expect(hubCopy('wow_guild').settingsTitle).toBe('Guild settings');
        render(<HubSettingsTrigger onOpen={() => undefined} label={hubCopy('game_community').settingsTitle} />);
        expect(screen.getByTestId('guild-settings-trigger')).toHaveTextContent('Hub settings');
    });

    it('renders the server copy on the attendance widget', () => {
        render(<GuildAttendance attendance={{ windowWeeks: 8, rows: [] }} kind="game_server" />);
        expect(screen.getByText(/once a session's attendance is taken/)).toBeInTheDocument();
    });
});

const NIGHT: GuildScheduleNightDto = {
    recurrenceGroupId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', eventId: 11, title: 'Valheim night', startTime: '2026-10-27T19:00:00.000Z',
    endTime: '2026-10-27T22:00:00.000Z', frequency: 'weekly', isNext: true,
};

/** ROK-1891 — the copy table: every kind, the strings the issue named. */
describe('hubCopy per kind (ROK-1891)', () => {
    it.each([
        ['wow_guild', 'Guild settings', 'No guild events in the last 8 weeks.', 'Weekly raid schedule', 'Next raid', 'Share news, plans or a welcome with everyone here.'],
        ['game_server', 'Server settings', 'No server events in the last 8 weeks.', 'Regular schedule', 'Next event', 'Share news, plans or a welcome with everyone in the hub.'],
        ['game_community', 'Hub settings', 'No hub events in the last 8 weeks.', 'Regular schedule', 'Next event', 'Share news, plans or a welcome with everyone in the hub.'],
    ] as const)('%s', (kind, settings, recent, schedule, next, prompt) => {
        const copy = hubCopy(kind);
        expect(copy.settingsTitle).toBe(settings);
        expect(copy.recentEmpty).toBe(recent);
        expect(copy.scheduleTitle).toBe(schedule);
        expect(copy.nextEventLabel).toBe(next);
        expect(copy.leaderPostPrompt).toBe(prompt);
    });

    it.each(['game_server', 'game_community'] as const)('%s copy never says guild, raid or roster', (kind) => {
        expect(Object.values(hubCopy(kind)).filter((v) => typeof v === 'string').join(' | ')).not.toMatch(/guild|raid|roster/i);
    });

    it('server and community schedules read "Regular schedule" with the repeat hint', () => {
        expect(hubCopy('game_server').scheduleEmpty).toBe('No repeating sessions yet. Make an event repeat and it shows here.');
        expect(hubCopy('game_community').scheduleEmpty).toBe(hubCopy('game_server').scheduleEmpty);
    });
});

describe('schedule card hides when empty off WoW (ROK-1891, operator ruling)', () => {
    it.each(['game_server', 'game_community'] as const)('%s: empty schedule renders nothing', (kind) => {
        const { container } = render(<GuildRaidSchedule schedule={[]} kind={kind} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('a server hub with a series shows the "Regular schedule" card', () => {
        render(<GuildRaidSchedule schedule={[NIGHT]} kind="game_server" />);
        expect(screen.getByText('Regular schedule')).toBeInTheDocument();
        expect(screen.getByText('Valheim night')).toBeInTheDocument();
    });

    it('a WoW guild keeps the empty card', () => {
        render(<GuildRaidSchedule schedule={[]} kind="wow_guild" />);
        expect(screen.getByText('Weekly raid schedule')).toBeInTheDocument();
        expect(screen.getByText(/No recurring raids yet/)).toBeInTheDocument();
    });
});

describe('members-first core widgets hide on 403 (ROK-1831)', () => {
    it('the leader post renders nothing on a 403', async () => {
        let hit = false;
        server.use(http.get(`${BASE}/profile`, () => { hit = true; return HttpResponse.json({ message: 'no' }, { status: 403 }); }));
        const { container, queryClient } = renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} kind="game_server" canOpenPosts />);
        await waitFor(() => expect(hit).toBe(true));
        await waitFor(() => expect(queryClient.getQueryCache().findAll().some((q) => q.state.status === 'error')).toBe(true));
        expect(screen.queryByTestId('guild-gm-post-error')).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it('the Discord mirror renders nothing on a 403', async () => {
        let hit = false;
        server.use(http.get(`${BASE}/discord`, () => { hit = true; return HttpResponse.json({ message: 'no' }, { status: 403 }); }));
        const { container, queryClient } = renderWithProviders(<GuildDiscordMirror guildId={7} canEdit={false} onChangeChannel={null} />);
        await waitFor(() => expect(hit).toBe(true));
        await waitFor(() => expect(queryClient.getQueryCache().findAll().some((q) => q.state.status === 'error')).toBe(true));
        expect(screen.queryByTestId('guild-discord-error')).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });
});

describe('hubSectionsLabel (ROK-1891)', () => {
    it('names the tab row after the hub kind', () => {
        expect(hubSectionsLabel('wow_guild')).toBe('Guild page sections');
        expect(hubSectionsLabel('game_server')).toBe('Server page sections');
        expect(hubSectionsLabel('game_community')).toBe('Hub page sections');
        expect(hubSectionsLabel(undefined)).toBe('Guild page sections');
    });
});

describe('rules card + private-channel acknowledgement copy', () => {
    const RULES: Readonly<Record<GuildKind, string>> = {
        wow_guild: 'Guild rules & loot rules',
        game_server: 'Server rules',
        game_community: 'Hub rules',
    };

    it.each(Object.entries(RULES) as [GuildKind, string][])('titles the rules card on a %s hub "%s"', (kind, title) => {
        expect(hubCopy(kind).rulesTitle).toBe(title);
        renderWithProviders(<GuildRules guildId={7} rules={[]} canEdit={false} kind={kind} />);
        expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    });

    it('keeps the WoW title when the kind is absent', () => {
        renderWithProviders(<GuildRules guildId={7} rules={[]} canEdit={false} />);
        expect(screen.getByRole('region', { name: 'Guild rules & loot rules' })).toBeInTheDocument();
    });

    it('names the hub kind in the private-channel acknowledgement', () => {
        expect(privateAckLabel('wow_guild')).toBe('Every member who can open this guild page will see this channel’s messages.');
        expect(privateAckLabel('game_server')).toBe('Every member who can open this server page will see this channel’s messages.');
        expect(privateAckLabel('game_community')).toBe('Every member who can open this hub page will see this channel’s messages.');
    });

    const NOTICES: Readonly<Record<GuildKind, [string, string, string]>> = {
        wow_guild: [
            "You're not a member of this guild. Link a character in the guild to see its page.",
            "We couldn't load this guild. Try again in a moment.",
            'Private Discord channel — everyone who can open this guild page sees it here',
        ],
        game_server: [
            "You're not a member of this server.",
            "We couldn't load this server. Try again in a moment.",
            'Private Discord channel — everyone who can open this server page sees it here',
        ],
        game_community: [
            "You're not a member of this hub.",
            "We couldn't load this hub. Try again in a moment.",
            'Private Discord channel — everyone who can open this hub page sees it here',
        ],
    };

    it.each(Object.entries(NOTICES) as [GuildKind, [string, string, string]][])('names a %s hub in the page notices and the Private tag', (kind, [notMember, loadFailed, privateTag]) => {
        expect(hubCopy(kind).notMember).toBe(notMember);
        expect(loadFailedLabel(kind)).toBe(loadFailed);
        expect(privateTagTitle(kind)).toBe(privateTag);
    });

    it('keeps the WoW notices when the kind is absent', () => {
        expect(hubCopy(undefined).notMember).toBe(NOTICES.wow_guild[0]);
        expect(loadFailedLabel(undefined)).toBe(NOTICES.wow_guild[1]);
        expect(privateTagTitle(undefined)).toBe(NOTICES.wow_guild[2]);
    });
});
