/**
 * ROK-2272 S5b — the admin "Event planning forum" card: 0 bound forums ⇒
 * "Bind a hub forum first"; 1 ⇒ "Using #name" read-only; ≥2 ⇒ the picker,
 * whose change PUTs the pick and shows the saved forum; load + save errors.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { EventPlanningForumSettingsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    EVENT_PLANNING_FORUM_URL, planningForumCandidate, planningForumSettings,
} from '../../../test/mocks/event-planning-forum-handlers';
import { EventPlanningForumCard } from './event-planning-forum-card';

const SHARED = planningForumCandidate();
const RAIDS = planningForumCandidate({ channelId: '423456789012345678', name: 'raid-forum', managed: false });
const LOOT = planningForumCandidate({ channelId: '523456789012345678', name: 'loot-forum', managed: false });

function serveGet(settings: EventPlanningForumSettingsDto): void {
    server.use(http.get(EVENT_PLANNING_FORUM_URL, () => HttpResponse.json(settings)));
}

function servePut(answer: (channelId: unknown) => Response): unknown[] {
    const puts: unknown[] = [];
    server.use(http.put(EVENT_PLANNING_FORUM_URL, async ({ request }) => {
        const body: unknown = await request.json();
        puts.push(body);
        const channelId = typeof body === 'object' && body !== null && 'channelId' in body ? body.channelId : null;
        return answer(channelId);
    }));
    return puts;
}

describe('EventPlanningForumCard — read-only lines and load error', () => {
    it('0 bound forums: says to bind a hub forum first, no picker', async () => {
        serveGet(planningForumSettings());
        renderWithProviders(<EventPlanningForumCard />);
        expect(await screen.findByTestId('event-planning-forum-none')).toHaveTextContent('Bind a hub forum first');
        expect(screen.queryByTestId('event-planning-forum-select')).toBeNull();
    });

    it('0 bound forums with the bot offline: says forums cannot be checked', async () => {
        serveGet(planningForumSettings({ warning: 'unknown' }));
        renderWithProviders(<EventPlanningForumCard />);
        expect(await screen.findByTestId('event-planning-forum-offline')).toHaveTextContent('The bot is offline');
    });

    it('1 bound forum: a read-only "Using #name" line, no picker', async () => {
        serveGet(planningForumSettings({ candidates: [SHARED], resolvedChannelId: SHARED.channelId }));
        renderWithProviders(<EventPlanningForumCard />);
        expect(await screen.findByTestId('event-planning-forum-using')).toHaveTextContent('Using #event-planning');
        expect(screen.queryByTestId('event-planning-forum-select')).toBeNull();
    });

    it('a failed load shows an error, not a picker', async () => {
        server.use(http.get(EVENT_PLANNING_FORUM_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderWithProviders(<EventPlanningForumCard />);
        expect(await screen.findByTestId('event-planning-forum-error')).toHaveTextContent('Couldn’t load the event planning forum');
        expect(screen.queryByTestId('event-planning-forum-select')).toBeNull();
    });
});

describe('EventPlanningForumCard — picker states', () => {
    it('≥2 bound forums, unset, one bot-made #event-planning: that forum is the default', async () => {
        serveGet(planningForumSettings({ candidates: [SHARED, RAIDS], resolvedChannelId: SHARED.channelId }));
        renderWithProviders(<EventPlanningForumCard />);
        const select = await screen.findByRole('combobox', { name: 'Discord forum' });
        expect(select).toHaveValue('');
        expect(screen.getByTestId('event-planning-forum-resolved')).toHaveTextContent('Posting to #event-planning');
        expect(screen.getByRole('option', { name: '#event-planning (made by the bot)' })).toBeInTheDocument();
    });

    it('≥2 bound forums whose names cannot be read: says forums cannot be checked, not "Not set"', async () => {
        serveGet(planningForumSettings({ candidates: [SHARED, RAIDS], warning: 'unknown' }));
        renderWithProviders(<EventPlanningForumCard />);
        const line = await screen.findByTestId('event-planning-forum-resolved');
        expect(line).toHaveTextContent('Forums can’t be checked right now');
        expect(line).not.toHaveTextContent('Not set');
    });

    it('≥2 bound forums with a stored pick: the "Choose a forum" prompt cannot be picked', async () => {
        serveGet(planningForumSettings({ candidates: [SHARED, RAIDS], channelId: RAIDS.channelId, resolvedChannelId: RAIDS.channelId }));
        renderWithProviders(<EventPlanningForumCard />);
        await screen.findByRole('combobox', { name: 'Discord forum' });
        expect(screen.getByRole('option', { name: 'Choose a forum' })).toBeDisabled();
    });
});

describe('EventPlanningForumCard — saving a pick', () => {
    it('≥2 bound forums, none bot-made: picking one PUTs it and shows the saved forum', async () => {
        // The resolver's real ambiguous state: no pick, no single bot-made #event-planning.
        serveGet(planningForumSettings({ candidates: [RAIDS, LOOT], warning: 'ambiguous' }));
        const puts = servePut((channelId) => HttpResponse.json(planningForumSettings({
            channelId: typeof channelId === 'string' ? channelId : null, candidates: [RAIDS, LOOT], resolvedChannelId: RAIDS.channelId,
        })));
        renderWithProviders(<EventPlanningForumCard />);
        const select = await screen.findByRole('combobox', { name: 'Discord forum' });
        expect(select).toHaveValue('');
        expect(screen.getByTestId('event-planning-forum-resolved')).toHaveTextContent('Not set');
        await userEvent.selectOptions(select, RAIDS.channelId);
        expect(await screen.findByText('Posting to #raid-forum')).toBeInTheDocument();
        expect(puts).toEqual([{ channelId: RAIDS.channelId }]);
        expect(select).toHaveValue(RAIDS.channelId);
    });

    it('≥2 bound forums: a refused save shows the server message inline', async () => {
        serveGet(planningForumSettings({ candidates: [SHARED, RAIDS], channelId: SHARED.channelId, resolvedChannelId: SHARED.channelId }));
        servePut(() => HttpResponse.json({ message: 'That channel is not a forum a hub is bound to' }, { status: 400 }));
        renderWithProviders(<EventPlanningForumCard />);
        const select = await screen.findByRole('combobox', { name: 'Discord forum' });
        expect(select).toHaveValue(SHARED.channelId);
        await userEvent.selectOptions(select, RAIDS.channelId);
        expect(await screen.findByText('That channel is not a forum a hub is bound to')).toBeInTheDocument();
        expect(screen.getByTestId('event-planning-forum-resolved')).toHaveTextContent('Posting to #event-planning');
    });

    it('≥2 bound forums: the select is disabled while a save is pending', async () => {
        serveGet(planningForumSettings({ candidates: [RAIDS, LOOT], warning: 'ambiguous' }));
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => { release = resolve; });
        server.use(http.put(EVENT_PLANNING_FORUM_URL, async () => {
            await held;
            return HttpResponse.json(planningForumSettings({ candidates: [RAIDS, LOOT], channelId: LOOT.channelId, resolvedChannelId: LOOT.channelId }));
        }));
        renderWithProviders(<EventPlanningForumCard />);
        const select = await screen.findByRole('combobox', { name: 'Discord forum' });
        await userEvent.selectOptions(select, LOOT.channelId);
        await waitFor(() => expect(select).toBeDisabled());
        release();
        await waitFor(() => expect(select).toBeEnabled());
    });
});
