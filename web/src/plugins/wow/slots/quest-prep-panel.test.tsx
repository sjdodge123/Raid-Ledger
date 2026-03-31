/**
 * TDD failing tests for ROK-995: Quest prep dungeon grouping.
 *
 * When an event has multiple dungeons, the quest prep section should
 * group quests by dungeon (with instance name headers), matching the
 * boss & loot panel behavior. Single-dungeon events render as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { QuestPrepPanel } from './quest-prep-panel';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// Mocks — external hooks the component depends on
// ---------------------------------------------------------------------------

vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
    getAuthToken: () => 'fake-token',
}));

vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: null, isLoading: false }),
}));

vi.mock('../hooks/use-wowhead-tooltips', () => ({
    useWowheadTooltips: () => {},
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const API = 'http://localhost:3000';

function createQuest(overrides: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 100,
        dungeonInstanceId: 1,
        name: 'Test Quest',
        questLevel: 25,
        requiredLevel: 20,
        expansion: 'classic',
        questGiverNpc: null,
        questGiverZone: null,
        prevQuestId: null,
        nextQuestId: null,
        rewardsJson: null,
        objectives: null,
        classRestriction: null,
        raceRestriction: null,
        startsInsideDungeon: false,
        sharable: true,
        rewardXp: null,
        rewardGold: null,
        rewardType: null,
        rewards: [],
        prerequisiteChain: null,
        ...overrides,
    };
}

// Two dungeon instances
const DEADMINES_INSTANCE = { id: 63, name: 'The Deadmines' };
const STOCKADE_INSTANCE = { id: 34, name: 'The Stockade' };

// Quests for Deadmines (instance 63)
const deadminesQuests: EnrichedDungeonQuestDto[] = [
    createQuest({ questId: 201, name: 'The Defias Brotherhood', dungeonInstanceId: 63, startsInsideDungeon: false, sharable: true }),
    createQuest({ questId: 202, name: 'Collecting Memories', dungeonInstanceId: 63, startsInsideDungeon: true, sharable: false }),
];

// Quests for Stockade (instance 34)
const stockadeQuests: EnrichedDungeonQuestDto[] = [
    createQuest({ questId: 301, name: 'Crime and Punishment', dungeonInstanceId: 34, startsInsideDungeon: false, sharable: true }),
    createQuest({ questId: 302, name: 'Quell The Uprising', dungeonInstanceId: 34, startsInsideDungeon: false, sharable: false }),
];

// Single-dungeon quests (only Deadmines)
const singleDungeonQuests: EnrichedDungeonQuestDto[] = [
    createQuest({ questId: 201, name: 'The Defias Brotherhood', dungeonInstanceId: 63, startsInsideDungeon: false, sharable: true }),
    createQuest({ questId: 202, name: 'Collecting Memories', dungeonInstanceId: 63, startsInsideDungeon: true, sharable: false }),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure MSW handlers for enriched quest + coverage endpoints */
function setupMswHandlers(
    instanceQuests: Record<number, EnrichedDungeonQuestDto[]>,
) {
    const handlers = Object.entries(instanceQuests).map(([id, quests]) =>
        http.get(`${API}/plugins/wow-classic/instances/${id}/quests/enriched`, () =>
            HttpResponse.json(quests),
        ),
    );

    // Empty coverage for all tests
    handlers.push(
        http.get(`${API}/plugins/wow-classic/events/:eventId/quest-coverage`, () =>
            HttpResponse.json([]),
        ),
    );

    server.use(...handlers);
}

function renderPanel(
    contentInstances: Record<string, unknown>[],
    eventId = 1,
    gameSlug = 'wow-classic-era',
) {
    return renderWithProviders(
        <QuestPrepPanel
            contentInstances={contentInstances}
            eventId={eventId}
            gameSlug={gameSlug}
        />,
    );
}

// ---------------------------------------------------------------------------
// Tests — multi-dungeon
// ---------------------------------------------------------------------------

describe('QuestPrepPanel — multi-dungeon grouping', () => {
    beforeEach(() => {
        server.resetHandlers();
    });

    it('renders dungeon instance name headers when multiple dungeons are selected', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('The Deadmines')).toBeInTheDocument();
        });
        expect(screen.getByText('The Stockade')).toBeInTheDocument();
    });

    it('preserves inside/outside grouping within each dungeon section', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        });

        const outsideGroups = screen.getAllByText(/Pick up before you go/);
        const insideGroups = screen.getAllByText(/Starts inside the dungeon/);

        // Deadmines + Stockade both have outside quests; Deadmines also has inside
        expect(outsideGroups.length).toBeGreaterThanOrEqual(2);
        expect(insideGroups.length).toBeGreaterThanOrEqual(1);
    });

    it('renders quest coverage controls within dungeon-grouped sections', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('The Deadmines')).toBeInTheDocument();
        });

        const coverageButtons = screen.getAllByTitle('I have this quest');
        expect(coverageButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('separates quests by dungeon so each dungeon section has its own quest list', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('Crime and Punishment')).toBeInTheDocument();
        });

        expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        expect(screen.getByText('Collecting Memories')).toBeInTheDocument();
        expect(screen.getByText('Quell The Uprising')).toBeInTheDocument();
    });

    it('uses quest-prep-instance__name class for instance headers (not boss-loot)', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('The Deadmines')).toBeInTheDocument();
        });

        const header = screen.getByText('The Deadmines');
        expect(header.className).toContain('quest-prep-instance__name');
        expect(header.className).not.toContain('boss-loot');
    });
});

// ---------------------------------------------------------------------------
// Tests — single-dungeon
// ---------------------------------------------------------------------------

describe('QuestPrepPanel — single-dungeon rendering', () => {
    beforeEach(() => {
        server.resetHandlers();
    });

    it('does not render dungeon instance header for single-dungeon events', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: singleDungeonQuests,
        });

        renderPanel([DEADMINES_INSTANCE]);

        await waitFor(() => {
            expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        });

        expect(screen.queryByText('The Deadmines')).not.toBeInTheDocument();
    });
});
