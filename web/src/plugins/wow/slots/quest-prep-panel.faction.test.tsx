/**
 * ROK-2211: the Quest Prep panel shows only the viewer's faction's quests —
 * a viewer with no character falls back to the event guild's faction, and a
 * "faction unknown" note shows only when no side is known at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { QuestPrepPanel } from './quest-prep-panel';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

const mocks = vi.hoisted(() => ({
    character: null as null | { race: string | null; faction: 'alliance' | 'horde' | null; class: string | null },
    guildFaction: null as string | null,
    /** Every guildId useGuildPage was called with (0 = the query is disabled). */
    guildCalls: [] as number[],
}));

vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
    useViewerCacheScope: () => 1,
    getAuthToken: () => 'fake-token',
}));
vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: mocks.character, isLoading: false }),
}));
vi.mock('../../../components/hub/api/use-guild', () => ({
    useGuildPage: (guildId: number) => {
        mocks.guildCalls.push(guildId);
        return { data: guildId > 0 && mocks.guildFaction !== null ? { guild: { faction: mocks.guildFaction } } : undefined };
    },
}));
vi.mock('../hooks/use-wowhead-tooltips', () => ({ useWowheadTooltips: () => {} }));

const API = 'http://localhost:3000';
const INSTANCE = { id: 43, name: 'Wailing Caverns' };

function q(questId: number, name: string, raceRestriction: string[] | null): EnrichedDungeonQuestDto {
    return {
        questId, dungeonInstanceId: INSTANCE.id, name, questLevel: 20, requiredLevel: 15, expansion: 'classic',
        questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null, rewardsJson: null,
        objectives: null, classRestriction: null, raceRestriction, startsInsideDungeon: false, sharable: true,
        rewardXp: null, rewardGold: null, rewardType: null, rewards: [], prerequisiteChain: null,
    };
}

const QUESTS = [
    q(1, 'Alliance Only Quest', ['Dwarf', 'Gnome', 'Human', 'Night Elf']),
    q(2, 'Horde Only Quest', ['Orc', 'Tauren', 'Troll', 'Undead']),
    q(3, 'Neutral Quest', []),
];

type Roster = { race?: string | null; faction?: string | null }[];

function renderPanel(guildId: number | null, rosterCharacters?: Roster, quests = QUESTS) {
    server.use(
        http.get(`${API}/plugins/wow-classic/instances/${INSTANCE.id}/quests/enriched`, () => HttpResponse.json(quests)),
        http.get(`${API}/plugins/wow-classic/events/:eventId/quest-coverage`, () => HttpResponse.json([])),
    );
    return renderWithProviders(<QuestPrepPanel contentInstances={[INSTANCE]} eventId={1} gameSlug="wow-classic-era" guildId={guildId}
        {...(rosterCharacters ? { rosterCharacters } : {})} />);
}

describe('QuestPrepPanel — faction filter (ROK-2211)', () => {
    beforeEach(() => {
        server.resetHandlers();
        mocks.character = null;
        mocks.guildFaction = null;
        mocks.guildCalls = [];
    });

    it('filters a raceless character by its faction column', async () => {
        mocks.character = { race: null, faction: 'horde', class: 'Warrior' };
        renderPanel(null);
        expect(await screen.findByText('Horde Only Quest')).toBeInTheDocument();
        expect(screen.getByText('Neutral Quest')).toBeInTheDocument();
        expect(screen.queryByText('Alliance Only Quest')).not.toBeInTheDocument();
        expect(screen.queryByTestId('quest-prep-faction-unknown')).not.toBeInTheDocument();
    });

    it('falls back to the guild faction when the viewer has no character', async () => {
        mocks.guildFaction = 'Alliance';
        renderPanel(7);
        expect(await screen.findByText('Alliance Only Quest')).toBeInTheDocument();
        expect(screen.getByText('Neutral Quest')).toBeInTheDocument();
        expect(screen.queryByText('Horde Only Quest')).not.toBeInTheDocument();
        expect(screen.queryByTestId('quest-prep-faction-unknown')).not.toBeInTheDocument();
    });

    it('shows both factions with a "faction unknown" note when no side is known', async () => {
        renderPanel(null);
        expect(await screen.findByText('Alliance Only Quest')).toBeInTheDocument();
        expect(screen.getByText('Horde Only Quest')).toBeInTheDocument();
        expect(screen.getByTestId('quest-prep-faction-unknown')).toHaveTextContent("Faction unknown — showing both factions' quests");
    });

    it("uses the signups' shared side before the guild page when the viewer has no character", async () => {
        mocks.guildFaction = 'Alliance';
        renderPanel(7, [{ race: 'Orc' }, { race: null, faction: 'horde' }, { race: null }]);
        // Neutral always renders, so the side assertions below fail on their own message.
        expect(await screen.findByText('Neutral Quest')).toBeInTheDocument();
        expect(screen.queryByText('Alliance Only Quest')).not.toBeInTheDocument();
        expect(screen.queryByText('Horde Only Quest')).toBeInTheDocument();
        expect(mocks.guildCalls.filter((id) => id !== 0)).toEqual([]);
    });

    it("never asks for the guild page when the viewer's side is known", async () => {
        mocks.character = { race: 'Human', faction: null, class: 'Warrior' };
        renderPanel(7);
        expect(await screen.findByText('Alliance Only Quest')).toBeInTheDocument();
        expect(mocks.guildCalls.length).toBeGreaterThan(0);
        expect(mocks.guildCalls.filter((id) => id !== 0)).toEqual([]);
    });

    it('shows no "faction unknown" note when the dungeon has no faction quests', async () => {
        renderPanel(null, undefined, [q(3, 'Neutral Quest', []), q(4, 'Other Neutral', null)]);
        expect(await screen.findByText('Neutral Quest')).toBeInTheDocument();
        expect(screen.queryByTestId('quest-prep-faction-unknown')).not.toBeInTheDocument();
    });
});
