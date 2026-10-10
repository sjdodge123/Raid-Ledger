/**
 * ROK-1726: the variant badge renders through the generic
 * `character-card:badges` slot, filled by the WoW plugin.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test/render-helpers';
import { PluginSlot } from '../../plugin-slot';
import { usePluginStore } from '../../../stores/plugin-store';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';

vi.mock('../../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({
        games: [
            { id: 7, slug: 'world-of-warcraft-forever' },
            { id: 8, slug: 'world-of-warcraft-classic' },
        ],
        isLoading: false,
        error: null,
    }),
}));

type SlotContext = { gameVariant: string | null; ruleset: string | null; gameId?: number | null };

function renderSlotWithClient(context: SlotContext) {
    const { container } = render(
        <QueryClientProvider client={createTestQueryClient()}>
            <PluginSlot name="character-card:badges" context={context} />
        </QueryClientProvider>,
    );
    return container.textContent;
}

function renderSlot(context: SlotContext) {
    const { container } = render(<PluginSlot name="character-card:badges" context={context} />);
    return container.textContent;
}

describe('CharacterVariantBadge via the character-card:badges slot', () => {
    beforeEach(() => activateWowPlugin());

    it.each([
        ['classic_era', null, 'Era'],
        ['classic_anniversary', null, 'TBC'],
        ['classic', null, 'Cata'],
        ['wow_forever', null, 'Forever'],
        // Manual WoW: Forever character (ROK-1721): no variant, a ruleset (OQ3).
        [null, 'pvp', 'Forever'],
    ])('gameVariant %j + ruleset %j → %s', (gameVariant, ruleset, label) => {
        expect(renderSlot({ gameVariant, ruleset })).toBe(label);
    });

    it.each([
        ['retail', null],
        [null, null],
        ['not-a-variant', null],
    ])('gameVariant %j + ruleset %j → no badge', (gameVariant, ruleset) => {
        expect(renderSlot({ gameVariant, ruleset })).toBe('');
    });

    it('renders nothing when the WoW plugin is inactive (OQ5)', () => {
        usePluginStore.setState({ activeSlugs: new Set() });
        expect(renderSlot({ gameVariant: 'classic_era', ruleset: null })).toBe('');
    });

    it('keeps the amber badge styling from the pre-slot card', () => {
        render(<PluginSlot name="character-card:badges" context={{ gameVariant: 'classic_era', ruleset: null }} />);
        expect(screen.getByText('Era').className).toContain('bg-amber-500/15 text-amber-400 border border-amber-500/30');
    });

    describe('ROK-1751: game slug from the registry (LedgerLink Forever, ruleset null)', () => {
        it('renders Forever for a Forever game id with null variant + ruleset', () => {
            expect(renderSlotWithClient({ gameVariant: null, ruleset: null, gameId: 7 })).toBe('Forever');
        });

        it('renders nothing for a Classic game id with null variant + ruleset', () => {
            expect(renderSlotWithClient({ gameVariant: null, ruleset: null, gameId: 8 })).toBe('');
        });

        it('keeps an explicit gameVariant over the game slug', () => {
            expect(renderSlotWithClient({ gameVariant: 'classic_era', ruleset: null, gameId: 7 })).toBe('Era');
        });

        it('does not throw without a QueryClientProvider (renders nothing)', () => {
            expect(renderSlot({ gameVariant: null, ruleset: null, gameId: 7 })).toBe('');
        });
    });
});
