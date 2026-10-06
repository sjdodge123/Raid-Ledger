/**
 * ROK-1724 — the "Import string" entry: the WoW plugin fills the generic
 * `character-detail:owner-actions` slot for WoW: Forever characters only, and
 * the core character page renders that slot for the owner only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { PluginSlot } from '../../plugin-slot';
import { usePluginStore } from '../../../stores/plugin-store';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { renderWithProviders } from '../../../test/render-helpers';
import { CharacterDetailPage } from '../../../pages/character-detail-page';

const detail = vi.hoisted(() => ({ character: null as unknown, userId: 0 }));
vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: detail.character, isLoading: false, error: null }),
}));
vi.mock('../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: detail.userId }, isAuthenticated: true }),
}));

const BUTTON = { name: /Import string/ };

function renderSlot(context: { ruleset: string | null; gameVariant: string | null }) {
    return renderWithProviders(<PluginSlot name="character-detail:owner-actions" context={{ characterId: 'c1', gameId: 7, ...context }} />);
}

describe('CharacterDetailOwnerActions via the character-detail:owner-actions slot', () => {
    beforeEach(() => activateWowPlugin());

    it.each([
        ['manual WoW: Forever (ruleset set)', { ruleset: 'normal', gameVariant: null }],
        ['WoW: Forever variant', { ruleset: null, gameVariant: 'wow_forever' }],
    ])('renders for %s', (_label, context) => {
        renderSlot(context);
        expect(screen.getByRole('button', BUTTON)).toBeInTheDocument();
    });

    it.each([
        ['classic era', { ruleset: null, gameVariant: 'classic_era' }],
        ['retail', { ruleset: null, gameVariant: 'retail' }],
        ['a non-WoW character', { ruleset: null, gameVariant: null }],
    ])('renders nothing for %s', (_label, context) => {
        renderSlot(context);
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
    });

    it('renders nothing while the WoW plugin is inactive', () => {
        usePluginStore.setState({ activeSlugs: new Set() });
        const { container } = render(<PluginSlot name="character-detail:owner-actions" context={{ characterId: 'c1', ruleset: 'normal', gameVariant: null }} />);
        expect(container.textContent).toBe('');
    });

    it('opens the Import string dialog', async () => {
        const user = userEvent.setup();
        renderSlot({ ruleset: 'normal', gameVariant: null });
        await user.click(screen.getByRole('button', BUTTON));
        expect(await screen.findByLabelText(/Export string/)).toBeInTheDocument();
    });
});

describe('CharacterDetailPage owner-actions slot', () => {
    beforeEach(() => {
        activateWowPlugin();
        detail.character = {
            id: 'c1', userId: 5, gameId: 7, name: 'Ana Forever', region: 'us', ruleset: 'normal', gameVariant: null,
            class: 'Paladin', level: 60, lastSyncedAt: null, equipment: null, avatarUrl: null, isMain: false,
        } as unknown as CharacterDto;
    });

    function renderPage() {
        renderWithProviders(<Routes><Route path="/characters/:id" element={<CharacterDetailPage />} /></Routes>, { initialEntries: ['/characters/c1'] });
    }

    it('shows Import string to the owner', () => {
        detail.userId = 5;
        renderPage();
        expect(screen.getByRole('button', BUTTON)).toBeInTheDocument();
    });

    it('hides Import string from another user', () => {
        detail.userId = 6;
        renderPage();
        expect(screen.getByRole('heading', { name: 'Ana Forever' })).toBeInTheDocument();
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
    });
});
