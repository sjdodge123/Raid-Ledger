/**
 * ROK-1738 — the WoW plugin fills the generic `character-create:header-actions`
 * slot with "Import LedgerLink character" + the "or add manually" divider,
 * only while the plugin is active and no game / the Forever game is picked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { PluginSlot } from '../../plugin-slot';
import { usePluginStore } from '../../../stores/plugin-store';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { renderWithProviders } from '../../../test/render-helpers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

const BUTTON = { name: /Import LedgerLink character/ };

function renderSlot(gameSlug: string) {
    return renderWithProviders(<PluginSlot name="character-create:header-actions" context={{ onClose: () => {}, gameSlug }} />);
}

describe('CharacterCreateHeaderActions via the character-create:header-actions slot', () => {
    beforeEach(() => activateWowPlugin());

    it.each([
        ['no game picked', ''],
        ['WoW: Forever picked', WOW_FOREVER_GAME_SLUG],
    ])('renders the button and the divider with %s', (_label, gameSlug) => {
        renderSlot(gameSlug);
        expect(screen.getByRole('button', BUTTON)).toBeInTheDocument();
        expect(screen.getByTestId('add-manually-divider')).toHaveTextContent('or add manually');
    });

    it.each([
        ['another WoW game', 'world-of-warcraft-classic'],
        ['a non-WoW game', 'final-fantasy-xiv-online'],
    ])('renders nothing once %s is picked', (_label, gameSlug) => {
        renderSlot(gameSlug);
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
        expect(screen.queryByTestId('add-manually-divider')).toBeNull();
    });

    it('renders nothing while the WoW plugin is inactive', () => {
        usePluginStore.setState({ activeSlugs: new Set() });
        renderSlot('');
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
        expect(screen.queryByTestId('add-manually-divider')).toBeNull();
    });
});
