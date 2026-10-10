/**
 * ROK-1756 — admin "Unlink character" for a LedgerLink GUID-linked character:
 * admins only (core slot), addon-linked only (filler), confirm required,
 * success toasts + navigates away, 409/404 toast the API's message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { CharacterDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { renderWithProviders } from '../../../test/render-helpers';
import { toast } from '../../../lib/toast';
import { CharacterDetailPage } from '../../../pages/character-detail-page';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const detail = vi.hoisted(() => ({ character: null as unknown, role: 'member' }));
vi.mock('../../../hooks/use-character-detail', () => ({
    useCharacterDetail: () => ({ data: detail.character, isLoading: false, error: null }),
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: detail.role }, isAuthenticated: true }),
}));

const UNLINK_URL = 'http://localhost:3000/admin/plugins/wow/characters/c1/unlink';
const BUTTON = { name: /Unlink character/ };

function setCharacter(addonLinked: boolean | undefined) {
    detail.character = {
        id: 'c1', userId: 5, gameId: 7, name: 'Squatter', region: 'us', ruleset: 'normal', gameVariant: null,
        class: 'Paladin', level: 60, lastSyncedAt: null, equipment: null, avatarUrl: null, isMain: false, addonLinked,
    } as unknown as CharacterDto;
}

function renderPage() {
    renderWithProviders(
        <Routes>
            <Route path="/characters/:id" element={<CharacterDetailPage />} />
            <Route path="/users/:userId" element={<p>Owner profile</p>} />
        </Routes>, { initialEntries: ['/characters/c1'] });
}

function mockUnlink(status: number, body: Record<string, unknown>) {
    const calls: string[] = [];
    server.use(http.post(UNLINK_URL, ({ request }) => { calls.push(request.url); return HttpResponse.json(body, { status }); }));
    return calls;
}

describe('CharacterDetailAdminActions (ROK-1756)', () => {
    beforeEach(() => { activateWowPlugin(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

    it('shows Unlink character to an admin on an addon-linked character', () => {
        detail.role = 'admin'; setCharacter(true);
        renderPage();
        expect(screen.getByRole('button', BUTTON)).toBeInTheDocument();
    });

    it('hides it from a non-admin, even on an addon-linked character', () => {
        detail.role = 'member'; setCharacter(true);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
    });

    it.each([['not addon-linked', false], ['link state unknown', undefined]])('hides it from an admin when %s', (_l, linked) => {
        detail.role = 'admin'; setCharacter(linked);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', BUTTON)).toBeNull();
    });

    it('asks for confirmation before calling the API, then deletes, toasts and navigates away', async () => {
        detail.role = 'admin'; setCharacter(true);
        const calls = mockUnlink(200, { characterId: 'c1', userId: 5, guid: 'Player-1-0A' });
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByRole('button', BUTTON));
        expect(await screen.findByText(/deletes/)).toHaveTextContent(/rightful owner can re-import/);
        expect(calls).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: 'Delete character' }));
        expect(await screen.findByText('Owner profile')).toBeInTheDocument();
        expect(calls).toHaveLength(1);
        expect(toast.success).toHaveBeenCalledWith('Squatter was unlinked and deleted.');
    });

    it('Cancel closes the confirm without calling the API', async () => {
        detail.role = 'admin'; setCharacter(true);
        const calls = mockUnlink(200, { characterId: 'c1', userId: 5, guid: 'g' });
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByRole('button', BUTTON));
        await user.click(await screen.findByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete character' })).toBeNull());
        expect(calls).toHaveLength(0);
    });

    it.each([
        [409, 'That character is not linked to an in-game character.'],
        [404, 'Character not found'],
    ])('toasts the API error on %i and stays on the page', async (status, message) => {
        detail.role = 'admin'; setCharacter(true);
        mockUnlink(status, { statusCode: status, message });
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByRole('button', BUTTON));
        await user.click(await screen.findByRole('button', { name: 'Delete character' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
        expect(toast.success).not.toHaveBeenCalled();
        expect(screen.queryByText('Owner profile')).toBeNull();
    });
});
