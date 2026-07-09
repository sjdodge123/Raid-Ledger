import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BanUserModal } from './BanUserModal';
import type { ModerationTarget } from './moderation-shared';

const REAL_TARGET: ModerationTarget = { id: 1, username: 'Alice', discordId: '123456789012345678' };
const WIPE_LABEL = /Wipe user data/;
const DISCORD_LABEL = /Also kick from Discord server/;

function renderModal(target: ModerationTarget | null, onConfirm = vi.fn(), onClose = vi.fn(), isPending = false) {
    render(<BanUserModal target={target} onClose={onClose} onConfirm={onConfirm} isPending={isPending} />);
    return { onConfirm, onClose };
}

describe('BanUserModal — rendering', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when target is null', () => {
        renderModal(null);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders a title with the username and the wipe-data option (default unchecked)', () => {
        renderModal(REAL_TARGET);
        expect(screen.getByText('Ban Alice')).toBeInTheDocument();
        const wipe = screen.getByLabelText(WIPE_LABEL) as HTMLInputElement;
        expect(wipe.checked).toBe(false);
    });

    it('shows the Discord checkbox for a real id and hides it for a placeholder id', () => {
        const { unmount } = render(<BanUserModal target={REAL_TARGET} onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
        expect(screen.getByLabelText(DISCORD_LABEL)).toBeInTheDocument();
        unmount();
        render(<BanUserModal target={{ id: 1, username: 'Alice', discordId: 'local:abc' }} onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
        expect(screen.queryByLabelText(DISCORD_LABEL)).not.toBeInTheDocument();
    });
});

describe('BanUserModal — confirm payload', () => {
    beforeEach(() => vi.clearAllMocks());

    it('confirms with wipeData=false and kickFromDiscord=false by default', () => {
        const { onConfirm } = renderModal(REAL_TARGET);
        fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
        expect(onConfirm).toHaveBeenCalledWith({ reason: undefined, wipeData: false, kickFromDiscord: false });
    });

    it('threads reason, wipeData and Discord kick into the payload', () => {
        const { onConfirm } = renderModal(REAL_TARGET);
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'cheating' } });
        fireEvent.click(screen.getByLabelText(WIPE_LABEL));
        fireEvent.click(screen.getByLabelText(DISCORD_LABEL));
        fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
        expect(onConfirm).toHaveBeenCalledWith({ reason: 'cheating', wipeData: true, kickFromDiscord: true });
    });

    it('disables the confirm button and shows a busy label while pending', () => {
        renderModal(REAL_TARGET, vi.fn(), vi.fn(), true);
        expect(screen.getByRole('button', { name: 'Banning...' })).toBeDisabled();
    });
});
