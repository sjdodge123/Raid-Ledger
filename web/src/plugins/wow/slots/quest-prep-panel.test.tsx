/**
 * TDD failing tests for ROK-995: Quest prep dungeon grouping.
 *
 * When an event has multiple dungeons, the quest prep section should
 * group quests by dungeon (with instance name headers), matching the
 * boss & loot panel behavior. Single-dungeon events render as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
// Tests
// ---------------------------------------------------------------------------

describe('QuestPrepPanel — multi-dungeon grouping (ROK-995)', () => {
    beforeEach(() => {
        // Reset handlers to defaults between tests
        server.resetHandlers();
    });

    // AC: Multi-dungeon events show quest prep grouped by dungeon with instance name headers
    it('renders dungeon instance name headers when multiple dungeons are selected', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        // After data loads, expect dungeon name headers to appear
        await waitFor(() => {
            expect(screen.getByText('The Deadmines')).toBeInTheDocument();
        });
        expect(screen.getByText('The Stockade')).toBeInTheDocument();
    });

    // AC: Within each dungeon section, existing inside/outside + type grouping preserved
    it('preserves inside/outside grouping within each dungeon section', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        // Wait for quests to render
        await waitFor(() => {
            expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        });

        // Both location groups should still exist
        const outsideGroups = screen.getAllByText(/Pick up before you go/);
        const insideGroups = screen.getAllByText(/Starts inside the dungeon/);

        // With multi-dungeon, we expect location groups within EACH dungeon section.
        // Deadmines has both outside and inside quests, Stockade has only outside.
        // So we should have at least 2 "Pick up before you go" headings (one per dungeon).
        expect(outsideGroups.length).toBeGreaterThanOrEqual(2);
        // Deadmines has an inside quest, so at least 1 inside group
        expect(insideGroups.length).toBeGreaterThanOrEqual(1);
    });

    // AC: Single-dungeon events render as before (no redundant header)
    it('does not render dungeon instance header for single-dungeon events', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: singleDungeonQuests,
        });

        renderPanel([DEADMINES_INSTANCE]);

        // Wait for quests to load
        await waitFor(() => {
            expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        });

        // Single dungeon — no instance name header should appear
        expect(screen.queryByText('The Deadmines')).not.toBeInTheDocument();
    });

    // AC: Quest progress tracking (checkboxes) still works correctly per quest
    it('renders quest coverage controls within dungeon-grouped sections', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        // Wait for dungeon-grouped rendering to complete
        await waitFor(() => {
            expect(screen.getByText('The Deadmines')).toBeInTheDocument();
        });
        expect(screen.getByText('The Stockade')).toBeInTheDocument();

        // Sharable quests from both dungeons should have coverage buttons
        // within their respective dungeon sections.
        const coverageButtons = screen.getAllByTitle('I have this quest');
        expect(coverageButtons.length).toBeGreaterThanOrEqual(2);
    });

    // AC: Quest coverage (sharable quest assignment) still works within dungeon groups
    it('separates quests by dungeon so each dungeon section has its own quest list', async () => {
        setupMswHandlers({
            [DEADMINES_INSTANCE.id]: deadminesQuests,
            [STOCKADE_INSTANCE.id]: stockadeQuests,
        });

        renderPanel([DEADMINES_INSTANCE, STOCKADE_INSTANCE]);

        // Wait for all quests to render
        await waitFor(() => {
            expect(screen.getByText('Crime and Punishment')).toBeInTheDocument();
        });

        // All four quests should be visible
        expect(screen.getByText('The Defias Brotherhood')).toBeInTheDocument();
        expect(screen.getByText('Collecting Memories')).toBeInTheDocument();
        expect(screen.getByText('Crime and Punishment')).toBeInTheDocument();
        expect(screen.getByText('Quell The Uprising')).toBeInTheDocument();

        // The dungeon headers should structure the DOM so Deadmines quests
        // are grouped separately from Stockade quests. We verify by checking
        // that the instance name headings exist as section markers.
        const deadminesHeader = screen.getByText('The Deadmines');
        const stockadeHeader = screen.getByText('The Stockade');
        expect(deadminesHeader).toBeInTheDocument();
        expect(stockadeHeader).toBeInTheDocument();
    });
});
