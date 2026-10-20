/**
 * ROK-1787/ROK-1830: the core Events tab, the WoW Raids tab, the Overview
 * raid widgets and the hero chip.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildAttendanceRowDto, GuildEventCardDto, GuildPage as GuildPageDto, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { emptyGuildRaids } from '../../../test/mocks/guild-raids-handlers';
import { at } from '../../../test/defined';
import { renderWithProviders } from '../../../test/render-helpers';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { GuildPage } from '../hub-page';
import { dayLabel, timeRange, timeShort } from './guild-raids.helpers';

const BASE = 'http://localhost:3000/guilds/7';
const CHAR_ID = '3f6c1a52-8a3b-4c0e-9d2f-1b2c3d4e5f60';
const GROUP_ID = '0d7e3f5a-1b2c-4d3e-8f9a-0b1c2d3e4f5a';

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 1, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function card(id: number, overrides: Partial<GuildEventCardDto> = {}): GuildEventCardDto {
    return { id, title: `Raid ${id}`, startTime: '2030-01-08T20:00:00.000Z', endTime: '2030-01-08T23:00:00.000Z', signupCount: 3, needed: 20, viewerStatus: null, ...overrides };
}

function attendee(userId: number): GuildAttendanceRowDto {
    return { userId, characterId: userId === 1 ? CHAR_ID : null, name: `Member ${userId}`, attended: 8 - userId, of: 8 };
}

const FULL: GuildRaidsDto = {
    upcoming: [card(41, { title: 'Molten Core Night', viewerStatus: 'signed_up' }), card(42, { viewerStatus: 'tentative' }), card(43)],
    recent: [{ id: 30, title: 'Onyxia Clear', startTime: '2029-12-30T20:00:00.000Z', signedUp: 4, attended: 3 }],
    schedule: [{ recurrenceGroupId: GROUP_ID, eventId: 41, title: 'Molten Core Night', startTime: '2030-01-08T20:00:00.000Z', endTime: '2030-01-08T23:00:00.000Z', frequency: 'weekly', isNext: true }],
    composition: {
        event: { id: 41, title: 'Molten Core Night', startTime: '2030-01-08T20:00:00.000Z' },
        roles: [{ role: 'tank', filled: 1, needed: 2 }, { role: 'healer', filled: 4, needed: 4 }, { role: 'dps', filled: 0, needed: 14 }],
        benched: [{ characterId: null, name: 'Benchwarmer' }],
    },
    attendance: { windowWeeks: 8, rows: [1, 2, 3, 4, 5, 6, 7].map(attendee) },
    nextRaid: card(41, { title: 'Molten Core Night', signupCount: 2 }),
};

function serve(raids: GuildRaidsDto | null, status = 200): void {
    server.use(
        http.get(BASE, () => HttpResponse.json(PAGE)),
        http.get(`${BASE}/raids`, () => (raids ? HttpResponse.json(raids) : HttpResponse.json({ message: 'nope' }, { status }))),
    );
}

function renderPage(hash = ''): void {
    window.location.hash = hash;
    renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });
}

afterEach(() => { window.location.hash = ''; });

beforeEach(() => { activateWowPlugin(); });

describe('Core Events tab (ROK-1830 S3c)', () => {
    it('renders the schedule, the whole attendance board and the full event lists', async () => {
        serve(FULL);
        renderPage('#events');
        const tab = await screen.findByTestId('guild-events-tab');
        expect(within(tab).getByTestId('guild-schedule-night')).toHaveTextContent('Molten Core Night');
        expect(within(tab).getByTestId('guild-schedule-night')).toHaveTextContent('Next');
        expect(within(tab).getAllByTestId('guild-attendance-row'), 'the Events tab shows every attendance row').toHaveLength(7);
        expect(within(tab).getAllByTestId('guild-upcoming-event')).toHaveLength(3);
        expect(within(tab).getByTestId('guild-recent-event')).toHaveTextContent('3 of 4 attended (75%)');
        expect(within(tab).getByText('Shown in your local time')).toBeInTheDocument();
        expect(within(tab).getByText('Last 8 weeks')).toBeInTheDocument();
    });

    it('leaves role composition to the WoW Raids tab', async () => {
        serve(FULL);
        renderPage('#events');
        const tab = await screen.findByTestId('guild-events-tab');
        expect(within(tab).queryByTestId('guild-composition-tank'), 'composition is the module tab\u2019s, not core\u2019s').toBeNull();
        expect(within(tab).queryByTestId('guild-bench')).toBeNull();
    });

    it('shows the viewer status pill or a Sign up link to the event', async () => {
        serve(FULL);
        renderPage('#events');
        const cards = await screen.findAllByTestId('guild-upcoming-event');
        expect(at(cards, 0)).toHaveTextContent("You're signed up");
        expect(at(cards, 1)).toHaveTextContent("You're tentative");
        expect(within(at(cards, 2)).getByRole('link', { name: 'Sign up for Raid 43' })).toHaveAttribute('href', '/events/43');
        expect(within(at(cards, 0)).getByRole('link', { name: 'Molten Core Night' })).toHaveAttribute('href', '/events/41');
    });

    it('shows a quiet empty state in every widget when the guild has no tagged events', async () => {
        serve(emptyGuildRaids);
        renderPage('#events');
        const tab = await screen.findByTestId('guild-events-tab');
        expect(tab).toHaveTextContent('No recurring raids yet.');
        expect(tab).toHaveTextContent('No attendance recorded yet.');
        expect(tab).toHaveTextContent('No upcoming guild events.');
        expect(screen.queryByTestId('guild-next-raid'), 'no next raid \u2192 no hero chip').toBeNull();
    });

    it('a failed raids load keeps the page and explains the tab', async () => {
        serve(null, 500);
        renderPage('#events');
        expect(await screen.findByTestId('guild-events-error', {}, { timeout: 5000 })).toHaveTextContent("We couldn't load this guild's events.");
        expect(screen.getByTestId('guild-hero')).toBeInTheDocument();
    });
});

describe('WoW Raids tab (ROK-1787, narrowed by ROK-1830 S3c)', () => {
    it('keeps role composition and the bench, and nothing core already shows', async () => {
        serve(FULL);
        renderPage('#raids');
        const tab = await screen.findByTestId('guild-raids-tab');
        expect(within(tab).getByTestId('guild-composition-tank')).toHaveTextContent('Need 1');
        expect(within(tab).getByTestId('guild-composition-healer')).toHaveTextContent('Full');
        expect(within(tab).getByTestId('guild-bench')).toHaveTextContent('Benchwarmer');
        expect(within(tab).queryByTestId('guild-schedule-night'), 'the schedule moved to the core Events tab').toBeNull();
        expect(within(tab).queryByTestId('guild-attendance-row'), 'attendance moved to the core Events tab').toBeNull();
        expect(within(tab).queryByTestId('guild-upcoming-event'), 'the event list moved to the core Events tab').toBeNull();
    });

    it('meters expose role="meter" with a clamped value', async () => {
        serve(FULL);
        renderPage('#raids');
        const tank = await screen.findByTestId('guild-composition-tank');
        expect(within(tank).getByRole('meter')).toHaveAttribute('aria-valuenow', '50');
    });

    it('shows the composition empty state when no upcoming raid has role slots', async () => {
        serve(emptyGuildRaids);
        renderPage('#raids');
        expect(await screen.findByTestId('guild-raids-tab')).toHaveTextContent('No upcoming raid with role slots.');
    });

    it('a failed raids load keeps the page and explains the tab', async () => {
        serve(null, 500);
        renderPage('#raids');
        expect(await screen.findByTestId('guild-raids-error', {}, { timeout: 5000 })).toHaveTextContent("We couldn't load this guild's raids.");
        expect(screen.getByTestId('guild-hero')).toBeInTheDocument();
    });
});

describe('Guild Overview raid widgets + hero chip (ROK-1787)', () => {
    it('caps attendance at 5 and the events card at two of each, with an #events jump', async () => {
        serve(FULL);
        renderPage();
        const overview = await screen.findByTestId('guild-overview');
        await waitFor(() => expect(within(overview).getAllByTestId('guild-attendance-row')).toHaveLength(5));
        expect(within(overview).getAllByTestId('guild-upcoming-event')).toHaveLength(2);
        expect(within(overview).getByTestId('guild-all-events'), 'core owns the event list now').toHaveAttribute('href', '#events');
        expect(within(overview).getByTestId('guild-schedule-night')).toBeInTheDocument();
        expect(within(overview).getByTestId('guild-composition-dps')).toBeInTheDocument();
    });

    it('the hero chip still jumps to the module tab (#raids) with the next raid signups', async () => {
        serve(FULL);
        renderPage();
        const chip = await screen.findByTestId('guild-next-raid');
        expect(chip.tagName, 'a plain anchor fires hashchange; a router Link would not').toBe('A');
        expect(chip).toHaveAttribute('href', '#raids');
        expect(chip).toHaveTextContent('2/20 signed');
        expect(chip.lastElementChild, 'date and count share one wrapping text run').toHaveTextContent(/Next raid: .+ · 2\/20 signed/);
    });

    it('upcoming cards show the start time once (date, then the time range)', async () => {
        serve(FULL);
        renderPage('#events');
        const cards = await screen.findAllByTestId('guild-upcoming-event');
        const start = timeShort('2030-01-08T20:00:00.000Z');
        const range = timeRange('2030-01-08T20:00:00.000Z', '2030-01-08T23:00:00.000Z');
        const text = within(at(cards, 0)).getByText(range, { exact: false }).textContent ?? '';
        expect(text.split(start).length - 1, `start time "${start}" should appear once in "${text}"`).toBe(1);
        expect(text).toBe(`${dayLabel('2030-01-08T20:00:00.000Z')} · ${range}`);
    });

    it('the hero count is singular at one member ("1 member")', async () => {
        serve(emptyGuildRaids);
        renderPage();
        expect((await screen.findByTestId('guild-member-count')).textContent).toBe('1 member');
    });
});
