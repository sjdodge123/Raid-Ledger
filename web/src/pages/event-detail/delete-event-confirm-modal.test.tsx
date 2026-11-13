/**
 * Delete Event confirm (overnight triage 2026-11-13, ROK-2068 rule): focus
 * starts on Keep Event, and while the delete is in flight Keep, Escape and
 * the header × cannot close the dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteEventConfirmModal } from './EventDetailModals';

function setup(isPending: boolean) {
    const onClose = vi.fn();
    render(<DeleteEventConfirmModal isOpen eventTitle="Raid Night" onClose={onClose} onConfirm={vi.fn()} isPending={isPending} />);
    return { onClose, keep: screen.getByRole('button', { name: 'Keep Event' }) };
}

describe('DeleteEventConfirmModal', () => {
    it('opens with focus on Keep Event', async () => {
        const { keep } = setup(false);
        // useFocusTrap focuses the initial element one animation frame after open.
        await waitFor(() => expect(keep).toHaveFocus());
    });

    it('cannot be closed while the delete is pending', () => {
        const { onClose, keep } = setup(true);
        expect(keep).toBeDisabled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByRole('button', { name: 'Close modal' })).toBeDisabled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
