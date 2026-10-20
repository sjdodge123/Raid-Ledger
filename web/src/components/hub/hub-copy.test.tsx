/**
 * ROK-1831 — kind-aware core widget copy, and members-first core widgets that
 * hide on a 403 instead of painting a red error card.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { HUB_COPY, hubCopy } from './hub-copy';
import { LatestPostCard } from './posts/latest-post-card';
import { GuildDiscordMirror } from './discord/guild-discord-mirror';
import { GuildRaidSchedule } from './events/guild-raid-schedule';
import { GuildAttendance } from './events/guild-attendance';
import { HubSettingsTrigger } from './settings/settings-trigger';

const BASE = 'http://localhost:3000/guilds/7';

describe('hubCopy (ROK-1831)', () => {
    it('switches leader, schedule and attendance copy by hub kind', () => {
        expect(hubCopy('game_server').leaderPostPill).toBe('From the server leader');
        expect(hubCopy('game_server').scheduleTitle).toBe('Upcoming sessions');
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

    it('renders the server copy on the schedule and attendance widgets', () => {
        render(<GuildRaidSchedule schedule={[]} kind="game_server" />);
        expect(screen.getByText('Upcoming sessions')).toBeInTheDocument();
        expect(screen.getByText('No sessions scheduled yet.')).toBeInTheDocument();
        render(<GuildAttendance attendance={{ windowWeeks: 8, rows: [] }} kind="game_server" />);
        expect(screen.getByText(/once a session's attendance is taken/)).toBeInTheDocument();
    });
});

describe('members-first core widgets hide on 403 (ROK-1831)', () => {
    it('the leader post renders nothing on a 403', async () => {
        let hit = false;
        server.use(http.get(`${BASE}/profile`, () => { hit = true; return HttpResponse.json({ message: 'no' }, { status: 403 }); }));
        const { container, queryClient } = renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} kind="game_server" />);
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
