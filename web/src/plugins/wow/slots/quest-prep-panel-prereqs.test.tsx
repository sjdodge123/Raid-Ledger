/**
 * ROK-1748 L5c: the Quest Prep panel fetches the viewer's pre-req chain state
 * (WoW: Forever only), shows the needed line and passes per-quest state down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { QuestPrepPanel } from './quest-prep-panel';
import type { EnrichedDungeonQuestDto, EventQuestPrereqsResponse } from '@raid-ledger/contract';

vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
    getAuthToken: () => 'fake-token',
}));
vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: null, isLoading: false }),
}));
vi.mock('../hooks/use-wowhead-tooltips', () => ({ useWowheadTooltips: () => {} }));

const API = 'http://localhost:3000';
const FOREVER = 'world-of-warcraft-forever';

function createQuest(overrides: Partial<EnrichedDungeonQuestDto>): EnrichedDungeonQuestDto {
    return {
        questId: 100, dungeonInstanceId: 1, name: 'Quest', questLevel: 25, requiredLevel: 20,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null,
        nextQuestId: null, rewardsJson: null, objectives: null, classRestriction: null,
        raceRestriction: null, startsInsideDungeon: false, sharable: true, rewardXp: null,
        rewardGold: null, rewardType: null, rewards: [], prerequisiteChain: null,
        ...overrides,
    };
}

const quests = [
    createQuest({ questId: 5, name: 'Shared Errand' }),
    createQuest({
        questId: 20, name: 'Chain Finale', prevQuestId: 10, sharable: false,
        prerequisiteChain: [
            createQuest({ questId: 10, name: 'Chain Start', nextQuestId: 20, sharable: false }),
            createQuest({ questId: 20, name: 'Chain Finale', prevQuestId: 10, sharable: false }),
        ],
    }),
];

const prereqs: EventQuestPrereqsResponse = {
    characterId: '11111111-1111-4111-8111-111111111111',
    asOf: '2026-10-01T12:00:00.000Z',
    quests: [{
        questId: 20,
        steps: [
            { questId: 10, name: 'Chain Start', done: true, source: 'addon' },
            { questId: 20, name: 'Chain Finale', done: false, source: null },
        ],
        neededCount: 2, completed: true, completedSource: 'addon',
    }],
    neededTotal: 2,
    asOfSource: 'addon',
    inProgressAsOf: '2026-11-09T12:00:00.000Z',
};

const NEEDED_LINE = 'Each player needs to complete 1 quest chain · you still need 2 more steps';

function setup(): { prereqCalls: () => number } {
    let calls = 0;
    let pickedUp = false;
    server.use(
        http.get(`${API}/plugins/wow-classic/instances/:id/quests/enriched`, () => HttpResponse.json(quests)),
        http.get(`${API}/plugins/wow-classic/events/:eventId/quest-coverage`, () => HttpResponse.json(
            pickedUp ? [{ questId: 5, coveredBy: [{ userId: 1, username: 'me' }] }] : [])),
        http.put(`${API}/plugins/wow-classic/events/:eventId/quest-progress`, () => {
            pickedUp = true;
            return HttpResponse.json({ id: 1, eventId: 7, userId: 1, username: 'me', questId: 5, pickedUp: true, completed: false });
        }),
        http.get(`${API}/plugins/wow-classic/events/:eventId/quest-prereqs/me`, () => {
            calls += 1;
            return HttpResponse.json(prereqs);
        }),
    );
    return { prereqCalls: () => calls };
}

function renderPanel(gameSlug: string) {
    return renderWithProviders(
        <QuestPrepPanel contentInstances={[{ id: 63, name: 'Dungeon' }]} eventId={7} gameSlug={gameSlug} />,
    );
}

describe('QuestPrepPanel — pre-req progress (ROK-1748)', () => {
    beforeEach(() => server.resetHandlers());

    it('shows the sharables and chains lines and the Done pill for a Forever event (ROK-2169)', async () => {
        setup();
        renderPanel(FOREVER);
        expect(await screen.findByText(NEEDED_LINE)).toHaveClass('text-warning');
        expect(screen.getByTestId('quest-prep-sharable-line')).toHaveTextContent(/^Someone needs to grab 1 sharable quest$/);
        expect(screen.getByText('Done')).toBeInTheDocument();
    });

    it('drops the sharables line once someone marks the quest picked up (ROK-2169)', async () => {
        setup();
        renderPanel(FOREVER);
        await screen.findByText(NEEDED_LINE);
        expect(screen.getByTestId('quest-prep-sharable-line')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('I have this quest'));
        await waitFor(() => expect(screen.queryByTestId('quest-prep-sharable-line')).toBeNull());
        expect(screen.getByText(NEEDED_LINE)).toBeInTheDocument();
    });

    it('mounts the "Your progress" as-of line under the header (ROK-2144 AC6)', async () => {
        setup();
        renderPanel(FOREVER);
        expect(await screen.findByTestId('quest-prep-progress-asof'))
            .toHaveTextContent('Your progress: completed list via addon · 1 Oct 2026 · quest log 9 Nov 2026');
    });

    it('passes the per-quest state to the chain when the card is expanded', async () => {
        setup();
        renderPanel(FOREVER);
        await screen.findByText(NEEDED_LINE);
        fireEvent.click(screen.getByText('Chain Finale'));
        expect(await screen.findByTestId('quest-prereq-mark-10')).toHaveClass('text-success');
    });

    it('never requests pre-req state for a Classic event (AC6)', async () => {
        const { prereqCalls } = setup();
        renderPanel('wow-classic-era');
        expect(await screen.findByText('Chain Finale')).toBeInTheDocument();
        expect(screen.getByTestId('quest-prep-chains-line'))
            .toHaveTextContent(/^Each player needs to complete 1 quest chain$/);
        expect(prereqCalls()).toBe(0);
    });

    it('refetches pre-req state after a progress update settles', async () => {
        const { prereqCalls } = setup();
        renderPanel(FOREVER);
        await screen.findByText(NEEDED_LINE);
        expect(prereqCalls()).toBe(1);
        fireEvent.click(screen.getByTitle('I have this quest'));
        await waitFor(() => expect(prereqCalls()).toBe(2));
    });
});
