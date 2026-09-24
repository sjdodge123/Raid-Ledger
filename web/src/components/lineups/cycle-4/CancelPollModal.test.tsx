/**
 * CancelPollModal tests (ROK-1655): the reason field, the guarded close paths
 * (Escape and the explicit Cancel ask before discarding a typed reason) and
 * the confirm dispatch. The trigger + navigation live in
 * __tests__/SchedulingCancelAction.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { CancelPollModal } from './CancelPollModal';

const discardConfirm = () =>
    screen.queryByRole('dialog', { name: 'Discard your changes?' });

function renderModal(isPending = false) {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(
        <CancelPollModal onClose={onClose} onConfirm={onConfirm} isPending={isPending} />,
    );
    return { onClose, onConfirm };
}

describe('CancelPollModal', () => {
    it('renders the title and the reason field', () => {
        renderModal();
        expect(screen.getByRole('heading', { name: 'Cancel poll?' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /Reason/i })).toBeInTheDocument();
    });

    it('asks before Escape discards a typed reason', async () => {
        const user = userEvent.setup();
        const { onClose } = renderModal();

        await user.type(screen.getByRole('textbox'), 'no quorum');
        await user.keyboard('{Escape}');
        expect(discardConfirm()).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('guards the explicit Cancel: Keep editing keeps the reason', async () => {
        const user = userEvent.setup();
        const { onClose } = renderModal();

        await user.type(screen.getByRole('textbox'), 'no quorum');
        await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(discardConfirm()).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(discardConfirm()).not.toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('no quorum');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a clean Cancel closes at once', async () => {
        const user = userEvent.setup();
        const { onClose, onConfirm } = renderModal();

        await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(discardConfirm()).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('confirm dispatches the cancel with the trimmed reason', async () => {
        const user = userEvent.setup();
        const { onClose, onConfirm } = renderModal();

        await user.type(screen.getByRole('textbox'), '  no quorum  ');
        const footer = screen.getByTestId('modal-footer');
        await user.click(within(footer).getByRole('button', { name: 'Cancel Poll' }));
        expect(onConfirm).toHaveBeenCalledWith('no quorum');
        expect(discardConfirm()).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('while pending the confirm is busy and swallows the click (ruling 7)', async () => {
        const user = userEvent.setup();
        const { onConfirm } = renderModal(true);

        const confirm = screen.getByRole('button', { name: /Cancelling/ });
        expect(confirm).toHaveAttribute('aria-busy', 'true');
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        await user.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
