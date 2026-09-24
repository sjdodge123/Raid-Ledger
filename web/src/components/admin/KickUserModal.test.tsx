import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

    // Ruling 7: Button `loading` never sets native `disabled` (focus stays), so the
    // equivalent-strength proof is aria-disabled + aria-busy + a swallowed click.
    it('marks the confirm button busy, names it "Kicking..." and swallows the click while pending', () => {
        const { onConfirm } = renderModal(REAL_TARGET, vi.fn(), vi.fn(), true);
        const confirm = screen.getByRole('button', { name: 'Kicking...' });
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        expect(confirm).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});

/*
 * ROK-1655 (ROK-1653 G1b): a typed reason must not vanish on Escape, the
 * backdrop, × or an explicit Cancel — the modal asks "Discard your changes?"
 * first. A blank (or whitespace-only) reason closes at once. Confirm and Cancel
 * sit in the Modal's pinned footer.
 */
const CONFIRM = 'Discard your changes?';
const kickDialog = () => screen.getByRole('dialog', { name: 'Kick Alice' });
const reasonField = () => screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
const typeReason = (value: string) => fireEvent.change(reasonField(), { target: { value } });

const CLOSE_PATHS: Array<[string, () => void]> = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }],
    ['×', () => { fireEvent.click(within(kickDialog()).getByRole('button', { name: 'Close modal' })); }],
    ['the backdrop', () => {
        fireEvent.click(kickDialog().parentElement!.querySelector('[aria-hidden="true"]') as HTMLElement);
    }],
];

describe('KickUserModal — dirty-close guard (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('with a typed reason, Escape asks; Keep editing keeps the reason and does not close', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('spamming');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText(CONFIRM), 'a dirty Escape must ask to discard').not.toBeNull();
        expect(onClose, 'a dirty Escape must not close').not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(reasonField(), 'Keep must leave the typed reason in place').toHaveValue('spamming');
    });

    it('with a typed reason, Discard calls onClose', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('spamming');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('discard-changes-discard'), 'a dirty Escape must offer Discard').not.toBeNull();
        expect(onClose, 'a dirty Escape must not close before Discard').not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each(CLOSE_PATHS)('with a clean reason, %s closes at once with no confirm', (_path, close) => {
        const { onClose } = renderModal(REAL_TARGET);
        close();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM), 'a clean close must not ask').not.toBeInTheDocument();
    });

    it('a whitespace-only reason counts as clean', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('   ');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    });

    it('with a typed reason, the footer Cancel asks instead of closing', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('spamming');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText(CONFIRM), 'an explicit Cancel is guarded (ruling 4)').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('KickUserModal — pinned footer (ROK-1655)', () => {
    it('Cancel and Kick sit in the modal-footer, outside the scrolling body', () => {
        renderModal(REAL_TARGET);
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the Modal must render its pinned footer').not.toBeNull();
        expect(footer!, 'Kick must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Kick' }));
        expect(footer!, 'Cancel must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Cancel' }));
        const body = footer!.previousElementSibling as HTMLElement;
        expect(body).toContainElement(reasonField());
        expect(body, 'the scroll body must not hold Kick').not.toContainElement(screen.getByRole('button', { name: 'Kick' }));
    });
});
