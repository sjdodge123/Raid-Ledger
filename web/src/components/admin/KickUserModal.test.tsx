import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KickUserModal } from './KickUserModal';
import type { ModerationTarget } from './moderation-shared';

const REAL_TARGET: ModerationTarget = { id: 1, username: 'Alice', discordId: '123456789012345678' };
const DISCORD_LABEL = /Also kick from Discord server/;

function renderModal(target: ModerationTarget | null, onConfirm = vi.fn(), onClose = vi.fn(), isPending = false) {
    render(<KickUserModal target={target} onClose={onClose} onConfirm={onConfirm} isPending={isPending} />);
    return { onConfirm, onClose };
}

describe('KickUserModal — visibility & title', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when target is null', () => {
        renderModal(null);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders a title with the username', () => {
        renderModal(REAL_TARGET);
        expect(screen.getByText('Kick Alice')).toBeInTheDocument();
    });
});

describe('KickUserModal — Discord checkbox gating', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows the Discord kick checkbox for a real Discord id', () => {
        renderModal(REAL_TARGET);
        expect(screen.getByLabelText(DISCORD_LABEL)).toBeInTheDocument();
    });

    it('hides the Discord checkbox for a local: placeholder id', () => {
        renderModal({ id: 1, username: 'Alice', discordId: 'local:abc' });
        expect(screen.queryByLabelText(DISCORD_LABEL)).not.toBeInTheDocument();
    });

    it('hides the Discord checkbox for an unlinked: placeholder id', () => {
        renderModal({ id: 1, username: 'Alice', discordId: 'unlinked:xyz' });
        expect(screen.queryByLabelText(DISCORD_LABEL)).not.toBeInTheDocument();
    });

    it('hides the Discord checkbox when discordId is null', () => {
        renderModal({ id: 1, username: 'Alice', discordId: null });
        expect(screen.queryByLabelText(DISCORD_LABEL)).not.toBeInTheDocument();
    });
});

describe('KickUserModal — confirm payload', () => {
    beforeEach(() => vi.clearAllMocks());

    it('confirms with an empty reason and kickFromDiscord=false by default', () => {
        const { onConfirm } = renderModal(REAL_TARGET);
        fireEvent.click(screen.getByRole('button', { name: 'Kick' }));
        expect(onConfirm).toHaveBeenCalledWith({ reason: undefined, kickFromDiscord: false });
    });

    it('threads a typed reason and the Discord checkbox into the payload', () => {
        const { onConfirm } = renderModal(REAL_TARGET);
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'spamming' } });
        fireEvent.click(screen.getByLabelText(DISCORD_LABEL));
        fireEvent.click(screen.getByRole('button', { name: 'Kick' }));
        expect(onConfirm).toHaveBeenCalledWith({ reason: 'spamming', kickFromDiscord: true });
    });

    it('calls onClose when Cancel is clicked', () => {
        const { onClose } = renderModal(REAL_TARGET);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('disables the confirm button and shows a busy label while pending', () => {
        renderModal(REAL_TARGET, vi.fn(), vi.fn(), true);
        expect(screen.getByRole('button', { name: 'Kicking...' })).toBeDisabled();
    });
});
