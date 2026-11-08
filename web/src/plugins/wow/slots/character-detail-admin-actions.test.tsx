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
const OWNER_BUTTON = { name: /Change owner/ };
/** ROK-2140: both admin actions sit behind the header's ⋯ menu at ≥ sm. */
const MENU = { name: 'More actions for Squatter' };

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', MENU));
}

function setCharacter(addonLinked: boolean | undefined, rosterClaimed?: boolean) {
    detail.character = {
        id: 'c1', userId: 5, gameId: 7, name: 'Squatter', region: 'us', ruleset: 'normal', gameVariant: null,
        class: 'Paladin', level: 60, lastSyncedAt: null, equipment: null, avatarUrl: null, isMain: false, addonLinked,
        ...(rosterClaimed === undefined ? {} : { rosterClaimed }),
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

    it('shows Unlink character to an admin on an addon-linked character', async () => {
        detail.role = 'admin'; setCharacter(true);
        const user = userEvent.setup();
        renderPage();
        await openMenu(user);
        expect(screen.getByRole('menuitem', BUTTON)).toBeInTheDocument();
    });

    it('hides it from a non-admin, even on an addon-linked character', () => {
        detail.role = 'member'; setCharacter(true);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', MENU)).toBeNull();
    });

    it.each([['not addon-linked', false], ['link state unknown', undefined]])('hides it from an admin when %s', (_l, linked) => {
        detail.role = 'admin'; setCharacter(linked);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', MENU)).toBeNull();
        expect(screen.queryByRole('menuitem', OWNER_BUTTON)).toBeNull();
    });

    it('asks for confirmation before calling the API, then deletes, toasts and navigates away', async () => {
        detail.role = 'admin'; setCharacter(true);
        const calls = mockUnlink(200, { characterId: 'c1', userId: 5 });
        const user = userEvent.setup();
        renderPage();
        await openMenu(user);
        await user.click(screen.getByRole('menuitem', BUTTON));
        expect(await screen.findByText(/deletes/)).toHaveTextContent(/rightful owner can re-import/);
        expect(calls).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: 'Delete character' }));
        expect(await screen.findByText('Owner profile')).toBeInTheDocument();
        expect(calls).toHaveLength(1);
        expect(toast.success).toHaveBeenCalledWith('Squatter was unlinked and deleted.');
    });

    it('Cancel closes the confirm without calling the API', async () => {
        detail.role = 'admin'; setCharacter(true);
        const calls = mockUnlink(200, { characterId: 'c1', userId: 5 });
        const user = userEvent.setup();
        renderPage();
        await openMenu(user);
        await user.click(screen.getByRole('menuitem', BUTTON));
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
        await openMenu(user);
        await user.click(screen.getByRole('menuitem', BUTTON));
        await user.click(await screen.findByRole('button', { name: 'Delete character' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
        expect(toast.success).not.toHaveBeenCalled();
        expect(screen.queryByText('Owner profile')).toBeNull();
    });
});

describe('CharacterDetailAdminActions visibility (ROK-2128)', () => {
    beforeEach(() => { activateWowPlugin(); });

    it('ROK-2128: hides both actions from an admin when the character is neither addon-linked nor roster-claimed', () => {
        detail.role = 'admin'; setCharacter(false, false);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', MENU)).toBeNull();
        expect(screen.queryByRole('menuitem', OWNER_BUTTON)).toBeNull();
    });

    it('ROK-2128: shows Unlink and Change owner to an admin on a roster-claimed character without a GUID', async () => {
        detail.role = 'admin'; setCharacter(false, true);
        const user = userEvent.setup();
        renderPage();
        await openMenu(user);
        expect(screen.getByRole('menuitem', BUTTON)).toBeInTheDocument();
        expect(screen.getByRole('menuitem', OWNER_BUTTON)).toBeInTheDocument();
    });

    it('ROK-2128: hides Change owner and Unlink from a non-admin on a roster-claimed character', () => {
        detail.role = 'member'; setCharacter(false, true);
        renderPage();
        expect(screen.getByRole('heading', { name: 'Squatter' })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', OWNER_BUTTON)).toBeNull();
        expect(screen.queryByRole('button', MENU)).toBeNull();
    });
});

const API = 'http://localhost:3000';
const OWNER_URL = `${API}/admin/plugins/wow/characters/c1/owner`;

function mockOwnerApis(status: number, body: Record<string, unknown>) {
    const bodies: unknown[] = [];
    server.use(
        http.get(`${API}/users/5/profile`, () => HttpResponse.json({ data: { id: 5, username: 'rosterA', avatar: null, discordId: null } })),
        http.get(`${API}/users`, () => HttpResponse.json({
            data: [{ id: 9, username: 'rosterB', avatar: null, discordId: null, customAvatarUrl: null }],
            meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        })),
        http.put(OWNER_URL, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(body, { status }); }),
    );
    return bodies;
}

async function openAndPick(user: ReturnType<typeof userEvent.setup>) {
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', OWNER_BUTTON));
    expect(await screen.findByText('rosterA')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    await user.type(screen.getByRole('combobox', { name: /New owner/ }), 'rosterB');
    await user.click(await screen.findByRole('option', { name: /rosterB/ }));
}

describe('CharacterChangeOwner (ROK-2128)', () => {
    beforeEach(() => { activateWowPlugin(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); detail.role = 'admin'; });

    it('names both users, sends the picked user id on Assign and toasts the new owner', async () => {
        setCharacter(false, true);
        const bodies = mockOwnerApis(200, { characterId: 'c1', fromUserId: 5, toUserId: 9 });
        const user = userEvent.setup();
        renderPage();
        await openAndPick(user);
        expect(await screen.findByText(/Moves Squatter from rosterA to rosterB/)).toBeInTheDocument();
        expect(bodies).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: 'Assign' }));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Squatter now belongs to rosterB.'));
        expect(bodies).toEqual([{ userId: 9 }]);
    });

    it('toasts the API message on 409 and keeps the dialog open', async () => {
        setCharacter(true, false);
        const message = 'rosterB already has a character named Squatter.';
        mockOwnerApis(409, { statusCode: 409, message });
        const user = userEvent.setup();
        renderPage();
        await openAndPick(user);
        await user.click(screen.getByRole('button', { name: 'Assign' }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
        expect(toast.success).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
    });

    it('Unlink in the Change owner footer hands off to the delete confirm without calling either API', async () => {
        setCharacter(false, true);
        const bodies = mockOwnerApis(200, {});
        const calls = mockUnlink(200, { characterId: 'c1', userId: 5 });
        const user = userEvent.setup();
        renderPage();
        await openMenu(user);
    await user.click(screen.getByRole('menuitem', OWNER_BUTTON));
        await user.click(await screen.findByRole('button', { name: 'Unlink' }));
        expect(await screen.findByRole('button', { name: 'Delete character' })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull());
        expect(calls).toHaveLength(0);
        expect(bodies).toHaveLength(0);
    });
});
