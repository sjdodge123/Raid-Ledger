/**
 * ROK-2140 — the character header at phone width is Option B (centred hero,
 * three stat tiles, Sync / Import string / More with a BottomSheet), and at
 * ≥ sm keeps the desktop row with a "⋯" admin menu and a labelled Sync.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { activateWowPlugin } from '../test/activate-wow-plugin';
import { renderWithProviders } from '../test/render-helpers';
import { CharacterDetailPage } from './character-detail-page';

const state = vi.hoisted(() => ({
    phone: false, role: 'admin', userId: 5, equippedItemLevel: null as number | null, listeners: new Set<() => void>(),
}));
// A subscribable stand-in for the media query, so a test can cross the breakpoint mid-render.
vi.mock('../hooks/use-media-query', async () => {
    const { useSyncExternalStore } = await import('react');
    const subscribe = (cb: () => void): (() => void) => { state.listeners.add(cb); return () => { state.listeners.delete(cb); }; };
    return { useMediaQuery: () => useSyncExternalStore(subscribe, () => state.phone) };
});

/** Flip the mocked viewport across the 640px breakpoint and notify subscribers. */
function crossBreakpoint(phone: boolean): void {
    act(() => { state.phone = phone; state.listeners.forEach((cb) => cb()); });
}
vi.mock('../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: { ...CHARACTER, equippedItemLevel: state.equippedItemLevel }, isLoading: false, error: null }),
}));
vi.mock('../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: state.userId, role: state.role }, isAuthenticated: true }),
}));

const CHARACTER = {
    id: 'c1', userId: 5, gameId: 7, name: 'Rok Androl', region: 'us', ruleset: null, gameVariant: 'wow_forever',
    faction: 'alliance', race: 'Night Elf', class: 'Warrior', spec: 'Protection', realm: 'RP-PvP', level: 22, itemLevel: 16,
    lastSyncedAt: new Date(Date.now() - 26 * 60 * 1000).toISOString(), equipment: null, avatarUrl: null, isMain: true,
    effectiveRole: 'tank', roleOverride: null, profileUrl: null, addonLinked: true, rosterClaimed: false,
} as unknown as CharacterDto;

function renderPage() {
    renderWithProviders(
        <Routes><Route path="/characters/:id" element={<CharacterDetailPage />} /></Routes>,
        { initialEntries: ['/characters/c1'] });
}

describe('character header at phone width — Option B (ROK-2140)', () => {
    beforeEach(() => { activateWowPlugin(); state.phone = true; state.role = 'admin'; state.userId = 5; state.equippedItemLevel = null; });

    it('renders the centred hero with three stat tiles: Item Level, Level, Updated', () => {
        renderPage();
        const hero = screen.getByTestId('character-header-phone');
        expect(hero).toHaveClass('text-center');
        const tiles = within(hero).getAllByTestId('character-stat-tile');
        expect(tiles.map((t) => t.textContent)).toEqual(['16Item Level', '22Level', '26mUpdated']);
    });

    it('colours the Item Level and Level tiles with flipping tokens, never a raw hue', () => {
        renderPage();
        const values = screen.getAllByTestId('character-stat-tile').map((t) => t.firstElementChild?.className ?? '');
        expect(values[0]).toContain('text-item-level');
        expect(values[1]).toContain('text-warning');
        expect(values.join(' ')).not.toMatch(/(purple|amber)-\d/);
    });

    it('renders the plugin portrait at Option B\'s 72px, not the 80px desktop size', () => {
        renderPage();
        const portrait = within(screen.getByTestId('character-header-phone')).getByTestId('forever-portrait');
        expect(portrait).toHaveClass('w-[72px]', 'h-[72px]');
        expect(portrait).not.toHaveClass('w-20');
    });

    it('shows the meta as race class · spec, then realm, with no dangling separator', () => {
        renderPage();
        expect(screen.getByText('Night Elf Warrior · Protection')).toBeInTheDocument();
        expect(screen.getByText('RP-PvP')).toBeInTheDocument();
    });

    it('gives the owner + admin three equal actions: Sync, Import string, More', () => {
        renderPage();
        const row = screen.getByTestId('character-header-actions');
        const names = within(row).getAllByRole('button').map((b) => b.textContent?.trim());
        expect(names).toEqual(['Sync', 'Import string', 'More']);
    });

    it('More opens a sheet holding Change owner and Unlink character', async () => {
        const user = userEvent.setup();
        renderPage();
        const more = screen.getByRole('button', { name: 'More' });
        expect(more).toHaveAttribute('aria-haspopup', 'dialog');
        await user.click(more);
        const sheet = await screen.findByRole('dialog', { name: /Rok Androl/ });
        expect(within(sheet).getByRole('menuitem', { name: /Change owner/ })).toBeInTheDocument();
        expect(within(sheet).getByRole('menuitem', { name: /Unlink character/ })).toBeInTheDocument();
    });

    it('an owner who is not an admin gets Sync and Import string but no More', () => {
        state.role = 'member';
        renderPage();
        const row = screen.getByTestId('character-header-actions');
        expect(within(row).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Sync', 'Import string']);
        expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    });
});

describe('character header at ≥ sm (ROK-2140 shared fixes)', () => {
    beforeEach(() => { activateWowPlugin(); state.phone = false; state.role = 'admin'; state.userId = 5; state.equippedItemLevel = null; });

    it('paints both Item Level and Equipped with the item-level token, never a raw purple (ROK-2165)', () => {
        state.equippedItemLevel = 18;
        renderPage();
        const line = screen.getByTestId('character-stat-line');
        expect(line).toHaveTextContent('Item Level 16 · Equipped 18 · Updated 26m ago');
        expect(within(line).getByText('16')).toHaveClass('text-item-level');
        expect(within(line).getByText('18')).toHaveClass('text-item-level');
        expect(line.innerHTML).not.toMatch(/(purple|amber)-\d/);
    });

    it('keeps the desktop row, a labelled Sync and a one-line item level + updated', () => {
        renderPage();
        expect(screen.queryByTestId('character-header-phone')).toBeNull();
        expect(screen.getByTestId('character-header-desktop')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Sync/ })).toHaveTextContent('Sync');
        expect(screen.getByTestId('character-stat-line')).toHaveTextContent('Item Level 16 · Updated 26m ago');
    });

    it('keeps the plugin portrait at 80px', () => {
        renderPage();
        expect(within(screen.getByTestId('character-header-desktop')).getByTestId('forever-portrait')).toHaveClass('w-20', 'h-20');
    });

    it('moves Change owner and Unlink into a "⋯" menu', async () => {
        const user = userEvent.setup();
        renderPage();
        expect(screen.queryByRole('menuitem', { name: /Unlink character/ })).toBeNull();
        const trigger = screen.getByRole('button', { name: 'More actions for Rok Androl' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        await user.click(trigger);
        const menu = screen.getByRole('menu');
        expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Change owner', 'Unlink character']);
    });
});

describe('crossing the 640px breakpoint (ROK-2140 Codex P2)', () => {
    beforeEach(() => { activateWowPlugin(); state.role = 'admin'; state.userId = 5; state.equippedItemLevel = null; });

    it.each([
        ['phone → desktop', true],
        ['desktop → phone', false],
    ])('keeps an open import dialog and its pasted string (%s)', async (_label, startPhone) => {
        state.phone = startPhone;
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByRole('button', { name: 'Import string' }));
        await user.type(await screen.findByLabelText(/Export string/), 'RL1-pasted');
        crossBreakpoint(!startPhone);
        expect(screen.getByTestId(startPhone ? 'character-header-desktop' : 'character-header-phone')).toBeInTheDocument();
        expect(screen.queryByLabelText(/Export string/)).toHaveValue('RL1-pasted');
    });
});
