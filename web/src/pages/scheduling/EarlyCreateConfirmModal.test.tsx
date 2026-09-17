/**
 * Lock-in confirm copy (ROK-1604 AC2): the DM deep link opens this modal even
 * when the majority threshold is met, so it needs a neutral variant.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EarlyCreateConfirmModal } from './EarlyCreateConfirmModal';

function renderModal(distinctVoters: number, memberCount: number) {
    return render(
        <EarlyCreateConfirmModal
            distinctVoters={distinctVoters}
            memberCount={memberCount}
            timeLabel="Fri 8:00 PM"
            onCancel={vi.fn()}
            onConfirm={vi.fn()}
        />,
    );
}

describe('EarlyCreateConfirmModal', () => {
    it('below majority keeps the early-lock warning', () => {
        renderModal(1, 5);
        expect(screen.getByText('Create event below majority?')).toBeInTheDocument();
        expect(screen.getByText(/Only 1 of 5 participants/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create anyway' })).toBeInTheDocument();
    });

    it('threshold met shows the neutral lock-in copy', () => {
        renderModal(3, 4);
        expect(screen.getByText('Lock in Fri 8:00 PM for everyone?')).toBeInTheDocument();
        expect(screen.getByText('3 of 4 participants have voted on this time.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Lock in' })).toBeInTheDocument();
        expect(screen.queryByText(/below majority/)).not.toBeInTheDocument();
    });
});
