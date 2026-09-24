/**
 * ROK-1655 (ROK-1650 C6b): a typed install size must not vanish on Escape,
 * the backdrop or × — the modal asks "Discard your changes?" first. A clean
 * modal still closes at once, and a successful save closes without asking.
 * Save size sits in the Modal's pinned footer and submits the field's
 * `<form>` through `form=`. (Kept apart from tie-modals.test.tsx, which is
 * near its line limit.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { TieReadinessGameDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { InstallSizeEntryModal } from './InstallSizeEntryModal';

vi.mock('../../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const API = 'http://localhost:3000';
const CONFIRM = 'Discard your changes?';
const TITLE = 'Size for Deep Rock Galactic';

const game: TieReadinessGameDto = {
    gameId: 11,
    gameName: 'Deep Rock Galactic',
    gameCoverUrl: null,
    voteCount: 4,
    steamAppId: 548430,
    ownedCount: 7,
    rosterSize: 9,
    youOwn: true,
    installSizeBytes: null,
    downloadSizeBytes: null,
    installSizeSource: null,
    installSizeUpdatedAt: null,
    estimatedDownloadMinutes: null,
    rosterEtas: [],
};

function renderSize() {
    const onClose = vi.fn();
    renderWithProviders(
        <InstallSizeEntryModal lineupId={7} game={game} isOpen onClose={onClose} />,
    );
    return { onClose };
}

/** Let the guard's one-macrotask Escape latch clear. */
const settle = (): Promise<void> => act(() => new Promise((r) => { setTimeout(r, 0); }));
const sizeDialog = (): HTMLElement => screen.getByRole('dialog', { name: TITLE });
const sizeField = (): HTMLElement => screen.getByLabelText(/Install size \(GB\)/);
const saveButton = (): HTMLElement => screen.getByRole('button', { name: 'Save size' });

describe('InstallSizeEntryModal — dirty-close guard (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('a clean Escape closes at once with no confirm', async () => {
        const { onClose } = renderSize();
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });

    it('after typing a size, Escape asks; Keep editing keeps the size', async () => {
        const user = userEvent.setup();
        const { onClose } = renderSize();
        await user.type(sizeField(), '12.5');
        await user.keyboard('{Escape}');
        expect(onClose, 'a dirty Escape must not close').not.toHaveBeenCalled();
        expect(screen.getByText(CONFIRM)).toBeInTheDocument();

        await user.click(screen.getByTestId('discard-changes-keep'));
        await settle();
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(sizeDialog()).toBeInTheDocument();
        expect(sizeField(), 'Keep must leave the typed size in place').toHaveValue(12.5);
    });

    it('after typing a size, × asks; Discard calls onClose', async () => {
        const user = userEvent.setup();
        const { onClose } = renderSize();
        await user.type(sizeField(), '40');
        await user.click(within(sizeDialog()).getByRole('button', { name: 'Close modal' }));
        expect(onClose, 'a dirty × must not close').not.toHaveBeenCalled();
        expect(screen.getByText(CONFIRM)).toBeInTheDocument();

        await user.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });

    it('a successful save closes without asking to discard', async () => {
        server.use(http.put(`${API}/games/11/install-size`, () => HttpResponse.json({ ok: true })));
        const user = userEvent.setup();
        const { onClose } = renderSize();
        await user.type(sizeField(), '12.5');
        await user.click(saveButton());
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(CONFIRM), 'a save must not ask to discard').not.toBeInTheDocument();
    });
});

describe('InstallSizeEntryModal — pinned footer (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('Save size sits in the modal-footer, outside the scrolling body', () => {
        renderSize();
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the Modal must render its pinned footer').not.toBeNull();
        expect(footer!, 'Save size must be in the pinned footer').toContainElement(saveButton());
        const body = footer!.previousElementSibling as HTMLElement;
        expect(body).toContainElement(sizeField());
        expect(body, 'the scroll body must not hold Save size').not.toContainElement(saveButton());
    });

    it('Save size is a submit button tied to the form by form=', () => {
        renderSize();
        const form = sizeField().closest('form');
        expect(form, 'the field must sit in a <form>').not.toBeNull();
        expect(saveButton()).toHaveAttribute('type', 'submit');
        expect(saveButton()).toHaveAttribute('form', form!.id);
        expect((saveButton() as HTMLButtonElement).form, 'Save size must be owned by the form').toBe(form);
    });

    it('clicking Save size submits the form', () => {
        renderSize();
        const onSubmit = vi.fn();
        sizeField().closest('form')?.addEventListener('submit', onSubmit);
        fireEvent.click(saveButton());
        expect(onSubmit, 'Save size must submit through form=').toHaveBeenCalledTimes(1);
    });

    it('an invalid size keeps the modal open with the inline danger error', async () => {
        const user = userEvent.setup();
        const { onClose } = renderSize();
        await user.type(sizeField(), '0');
        await user.click(saveButton());
        const alert = screen.getByRole('alert');
        expect(alert.textContent).not.toBe('');
        expect(alert).toHaveClass('text-danger');
        expect(sizeField()).toHaveAttribute('aria-invalid', 'true');
        expect(onClose, 'an invalid size must not close').not.toHaveBeenCalled();
        expect(sizeDialog()).toBeInTheDocument();
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });
});
