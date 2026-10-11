/**
 * ROK-1761 review fix: the Attendees card draws the Forever portrait from the
 * CHARACTER's own game / variant / ruleset — never the event's game.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { EventRosterDto } from '@raid-ledger/contract';
import { EventDetailRoster } from './EventDetailRoster';
import { createMockEvent } from '../../test/factories';
import { renderWithProviders } from '../../test/render-helpers';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { usePluginStore } from '../../stores/plugin-store';

const FOREVER_GAME_ID = 7;
const CLASSIC_GAME_ID = 3;

vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({
        games: [
            { id: 7, slug: 'world-of-warcraft-forever' },
            { id: 3, slug: 'world-of-warcraft-classic' },
        ],
        isLoading: false,
        error: null,
    }),
}));

function character(overrides: Record<string, unknown>) {
    return {
        id: '17610000-0000-4000-8000-0000000000c1', name: 'Fernwhisper', class: 'Druid', spec: null,
        role: 'healer' as const, isMain: true, itemLevel: null, level: 25, avatarUrl: null, race: 'Night Elf',
        ...overrides,
    };
}

function renderWith(char: ReturnType<typeof character>, eventGameId: number) {
    const signup = {
        id: 1, eventId: 1, user: { id: 10, username: 'TestPlayer', avatar: null, discordId: '123' },
        note: null, signedUpAt: '2026-10-01T10:00:00Z', characterId: char.id, character: char,
        confirmationStatus: 'confirmed' as const, status: 'signed_up' as const, preferredRoles: null,
    };
    const roster = { eventId: 1, signups: [signup], count: 1 } as unknown as EventRosterDto;
    const base = createMockEvent();
    const event = { ...base, game: { ...base.game!, id: eventGameId } };
    renderWithProviders(<EventDetailRoster roster={roster} event={event} />);
}

describe('EventDetailRoster — Forever portrait follows the character, not the event (ROK-1761)', () => {
    // The tile reaches core through the WoW plugin's PortraitFallback seam, so the plugin must be registered + active.
    beforeEach(activateWowPlugin);
    afterEach(() => usePluginStore.setState({ activeSlugs: new Set() }));
    it('a Classic character with no avatar on a Forever event gets NO Forever tile', () => {
        renderWith(character({ gameId: CLASSIC_GAME_ID, gameVariant: 'classic_era', ruleset: null }), FOREVER_GAME_ID);
        expect(screen.queryByTestId('forever-portrait'), 'Classic character must not borrow the Forever event game').toBeNull();
    });

    it('a Forever character with no avatar on a non-Forever event still gets the tile', () => {
        renderWith(character({ gameId: FOREVER_GAME_ID, gameVariant: null, ruleset: null }), CLASSIC_GAME_ID);
        expect(screen.queryByTestId('forever-portrait'), 'Forever character keeps its own tile').not.toBeNull();
    });
});
