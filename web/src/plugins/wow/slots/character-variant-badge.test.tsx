/**
 * ROK-1726: the variant badge renders through the generic
 * `character-card:badges` slot, filled by the WoW plugin.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginSlot } from '../../plugin-slot';
import { usePluginStore } from '../../../stores/plugin-store';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';

function renderSlot(context: { gameVariant: string | null; ruleset: string | null }) {
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
});
