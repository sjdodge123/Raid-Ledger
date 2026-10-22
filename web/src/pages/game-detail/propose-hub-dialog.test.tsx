/** ROK-1870 W3/W4 — the "Start a community hub" proposal form. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { communityHubHandlers } from '../../test/handlers/community-hubs';
import { mockDesktop } from '../../test/handlers/media';
import { toast } from '../../lib/toast';
import { ProposeHubDialog } from './propose-hub-dialog';

const API = 'http://localhost:3000';
const auth = vi.hoisted(() => ({ role: 'member' as 'member' | 'operator' | 'admin' }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/use-auth', async (orig) => ({
    ...(await orig<typeof import('../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, username: 'You', role: auth.role }, isLoading: false }),
}));
vi.mock('react-router-dom', async (orig) => ({
    ...(await orig<typeof import('react-router-dom')>()),
    useNavigate: () => navigate,
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderDialog(onClose = vi.fn()): void {
    renderWithProviders(<ProposeHubDialog isOpen onClose={onClose} gameId={5} gameName="Baldur's Gate 3" />);
}

async function fill(name: string, blurb = 'Casual co-op.', submit = 'Send for review'): Promise<void> {
    await userEvent.type(screen.getByLabelText('Hub name'), name);
    await userEvent.type(screen.getByLabelText('Short description'), blurb);
    await userEvent.click(screen.getByRole('button', { name: submit }));
}

afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
    vi.mocked(toast.success).mockClear();
    navigate.mockClear();
    auth.role = 'member';
});

describe('ProposeHubDialog', () => {
    it('W3: a 2-character name is refused before any request', async () => {
        let posts = 0;
        server.use(http.post(`${API}/hubs/proposals`, () => { posts += 1; return HttpResponse.json({}, { status: 201 }); }));
        mockDesktop(true);
        renderDialog();
        await fill('ab');
        expect(await screen.findByText('Hub name must be 3–64 characters.')).toBeInTheDocument();
        expect(posts).toBe(0);
    });

    it('W3: a 409 name clash lands on the name field', async () => {
        server.use(http.post(`${API}/hubs/proposals`, () =>
            HttpResponse.json({ message: 'A hub with that name already exists for this game' }, { status: 409 })));
        mockDesktop(true);
        renderDialog();
        await fill('Tavern Regulars');
        expect(await screen.findByText('A hub with that name already exists for this game')).toBeInTheDocument();
        expect(screen.getByLabelText('Hub name')).toHaveAttribute('aria-invalid', 'true');
    });

    it('a 409 pending-for-game refusal shows in the form banner', async () => {
        server.use(http.post(`${API}/hubs/proposals`, () =>
            HttpResponse.json({ message: 'You already have a proposal waiting for this game' }, { status: 409 })));
        mockDesktop(true);
        renderDialog();
        await fill('Owlbear Club');
        expect(await screen.findByRole('alert')).toHaveTextContent('You already have a proposal waiting for this game');
    });

    it('closes on success', async () => {
        server.use(...communityHubHandlers());
        mockDesktop(true);
        const onClose = vi.fn();
        renderDialog(onClose);
        await fill('Owlbear Club');
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('W4: desktop opens a Modal', () => {
        mockDesktop(true);
        renderDialog();
        expect(screen.getByTestId('modal-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('bottom-sheet-footer')).not.toBeInTheDocument();
    });

    it('W4: phone opens a BottomSheet', () => {
        mockDesktop(false);
        renderDialog();
        expect(screen.getByTestId('bottom-sheet-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('modal-footer')).not.toBeInTheDocument();
    });
});

describe('ProposeHubDialog — ROK-1892 staff proposals go live', () => {
    it('ROK-1892: a member is told an admin reviews it, and stays on the page', async () => {
        server.use(...communityHubHandlers());
        mockDesktop(true);
        renderDialog();
        expect(screen.getByText(/An admin reviews new hubs/)).toBeInTheDocument();
        await fill('Owlbear Club');
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sent for review'));
        expect(navigate).not.toHaveBeenCalled();
    });

    it.each(['admin', 'operator'] as const)('ROK-1892: an %s sees "goes live" copy and lands on the live hub', async (role) => {
        auth.role = role;
        server.use(...communityHubHandlers());
        mockDesktop(true);
        const onClose = vi.fn();
        renderDialog(onClose);
        expect(screen.getByText(/skips review and goes live right away/)).toBeInTheDocument();
        expect(screen.queryByText(/An admin reviews new hubs/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument();
        await fill('Owlbear Club', 'Casual co-op.', 'Create hub');
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/guilds/99'));
        expect(toast.success).toHaveBeenCalledWith('Your hub is live');
        expect(onClose).toHaveBeenCalled();
    });
});
