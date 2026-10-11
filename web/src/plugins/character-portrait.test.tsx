/** ROK-1761: core's game-agnostic portrait seam — plugin portrait when active, the wrapped avatar otherwise. */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CharacterPortraitFallback } from './character-portrait';
import { activateWowPlugin } from '../test/activate-wow-plugin';
import { usePluginStore } from '../stores/plugin-store';

const existing = <span data-testid="existing-avatar">existing</span>;
const pluginOwned = { name: 'Ayla', avatarUrl: null, race: 'Human', class: 'Mage', gameVariant: null, ruleset: 'pvp', gameId: 1 };
const plain = { name: 'Bob', avatarUrl: null, race: 'Human', class: 'Mage', gameVariant: null, ruleset: null, gameId: null };

afterEach(() => usePluginStore.setState({ activeSlugs: new Set() }));

describe('CharacterPortraitFallback (ROK-1761 seam)', () => {
    it('renders exactly the wrapped avatar when no plugin is active', () => {
        usePluginStore.setState({ activeSlugs: new Set() });
        render(<CharacterPortraitFallback character={pluginOwned} size="md">{existing}</CharacterPortraitFallback>);
        expect(screen.getByTestId('existing-avatar'), 'inactive plugin: core keeps its own avatar').toBeInTheDocument();
        expect(screen.queryByTestId('forever-portrait')).toBeNull();
    });

    it("renders the active plugin's portrait for a character it claims", () => {
        activateWowPlugin();
        render(<CharacterPortraitFallback character={pluginOwned} size="md">{existing}</CharacterPortraitFallback>);
        expect(screen.getByTestId('forever-portrait'), 'active WoW plugin swaps in its tile').toHaveAttribute('aria-label', 'Ayla');
        expect(screen.queryByTestId('existing-avatar')).toBeNull();
    });

    it('passes a character no plugin claims straight through, even with the plugin active', () => {
        activateWowPlugin();
        render(<CharacterPortraitFallback character={plain} size="sm">{existing}</CharacterPortraitFallback>);
        expect(screen.getByTestId('existing-avatar')).toBeInTheDocument();
        expect(screen.queryByTestId('forever-portrait')).toBeNull();
    });
});
