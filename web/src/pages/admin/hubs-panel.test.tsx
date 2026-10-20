/** ROK-1870 W10 — Admin → Hubs queue: tabs, approve/reject, archive/restore, create. */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { setAuthToken } from '../../hooks/use-auth';
import {
    adminHubsHandlers, conflict, makeAdminHub, makeAdminHubsStore, makeHubProposal, type AdminHubsStore,
} from '../../test/handlers/admin-hubs';
import { HubsPanel } from './hubs-panel';

let store: AdminHubsStore;

function renderPanel(hash = ''): void {
    window.location.hash = hash;
    renderWithProviders(<HubsPanel />);
}

beforeEach(() => {
    setAuthToken('test-token');
    store = makeAdminHubsStore({
        proposals: [makeHubProposal(), makeHubProposal({ id: 2, name: 'Night Owls', proposedBy: { userId: 8, username: 'Astarion', avatarUrl: null } })],
        active: [makeAdminHub(), makeAdminHub({ id: 101, name: 'Orphans', leaderName: null, leaderless: true })],
        archived: [makeAdminHub({ id: 102, name: 'Old Crew' })],
    });
    server.use(...adminHubsHandlers(store));
});

afterEach(() => { window.location.hash = ''; });

const row = async (name: string): Promise<HTMLElement> => (await screen.findByText(name)).closest('li') ?? document.body;

describe('HubsPanel — pending queue (W10)', () => {
    it('labels the pending tab with its count and lists each proposal with its proposer', async () => {
        renderPanel();
        expect(await screen.findByRole('link', { name: 'Pending (2)' })).toHaveAttribute('aria-current', 'page');
        expect(within(await row('BG3 Crew')).getByText('Shadowmere')).toBeInTheDocument();
        expect(screen.getByText('Night Owls')).toBeInTheDocument();
    });

    it('Reject keeps submit disabled without a reason; with one it POSTs and the row leaves', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(within(await row('BG3 Crew')).getByRole('button', { name: 'Reject' }));
        const dialog = await screen.findByRole('dialog');
        const submit = within(dialog).getByRole('button', { name: 'Reject proposal' });
        expect(submit).toBeDisabled();
        await user.type(within(dialog).getByLabelText(/Reason/), 'Duplicate of Tav Party');
        expect(submit).toBeEnabled();
        await user.click(submit);
        await waitFor(() => expect(screen.queryByText('BG3 Crew')).not.toBeInTheDocument());
        expect(store.requests).toContainEqual({ method: 'POST', path: '/admin/hubs/proposals/1/reject', body: { reason: 'Duplicate of Tav Party' } });
    });

    it('Approve sends the tidied name and blurb', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(within(await row('BG3 Crew')).getByRole('button', { name: 'Approve' }));
        const dialog = await screen.findByRole('dialog');
        const name = within(dialog).getByLabelText(/Hub name/);
        await user.clear(name);
        await user.type(name, 'BG3 Crew EU');
        await user.click(within(dialog).getByRole('button', { name: 'Approve hub' }));
        await waitFor(() => expect(screen.queryByText('BG3 Crew')).not.toBeInTheDocument());
        expect(store.requests).toContainEqual({
            method: 'POST', path: '/admin/hubs/proposals/1/approve', body: { name: 'BG3 Crew EU', blurb: 'Weekly co-op runs.' },
        });
    });

    it('shows a 409 from approve inline and keeps the dialog open', async () => {
        const user = userEvent.setup();
        server.use(conflict('post', '/admin/hubs/proposals/:id/approve', 'The proposer is no longer active — create the hub directly'));
        renderPanel();
        await user.click(within(await row('BG3 Crew')).getByRole('button', { name: 'Approve' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Approve hub' }));
        expect(await within(dialog).findByText(/no longer active/)).toBeInTheDocument();
    });
});

describe('HubsPanel — active and archived hubs', () => {
    it('flags a leaderless hub and archives a hub through PATCH status', async () => {
        const user = userEvent.setup();
        renderPanel('#active');
        expect(within(await row('Orphans')).getByText('No leader')).toBeInTheDocument();
        await user.click(within(await row('Tav Party')).getByRole('button', { name: 'Archive' }));
        await waitFor(() => expect(store.requests).toContainEqual({ method: 'PATCH', path: '/hubs/100/status', body: { status: 'archived' } }));
    });

    it('restores an archived hub', async () => {
        const user = userEvent.setup();
        renderPanel('#archived');
        await user.click(within(await row('Old Crew')).getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(store.requests).toContainEqual({ method: 'PATCH', path: '/hubs/102/status', body: { status: 'active' } }));
    });

    it('Transfer leader opens a dialog whose submit waits for a chosen user', async () => {
        const user = userEvent.setup();
        renderPanel('#active');
        await user.click(within(await row('Tav Party')).getByRole('button', { name: 'Transfer leader' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Transfer' })).toBeDisabled();
    });
});

describe('HubsPanel — create hub', () => {
    it('opens the create form with every field and a disabled submit', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(await screen.findByRole('button', { name: 'Create hub' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText(/Game/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/Leader/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    });
});
