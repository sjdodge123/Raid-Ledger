/** ROK-1870 W3/W4 — the "Start a community hub" proposal form. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { communityHubHandlers } from '../../test/handlers/community-hubs';
import { mockDesktop } from '../../test/handlers/media';
import { ProposeHubDialog } from './propose-hub-dialog';

const API = 'http://localhost:3000';

function renderDialog(onClose = vi.fn()): void {
    renderWithProviders(<ProposeHubDialog isOpen onClose={onClose} gameId={5} gameName="Baldur's Gate 3" />);
}

async function fill(name: string, blurb = 'Casual co-op.'): Promise<void> {
    await userEvent.type(screen.getByLabelText('Hub name'), name);
    await userEvent.type(screen.getByLabelText('Short description'), blurb);
    await userEvent.click(screen.getByRole('button', { name: 'Send for review' }));
}

afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });

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
