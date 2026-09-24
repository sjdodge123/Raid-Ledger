import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

    it('links the wipe checkbox to its danger-toned irreversibility warning', () => {
        renderModal(REAL_TARGET);
        const wipe = screen.getByLabelText(WIPE_LABEL);
        expect(wipe).toHaveAttribute('aria-describedby');
        const description = document.getElementById(wipe.getAttribute('aria-describedby') ?? '');
        expect(description).toHaveTextContent(/This cannot be undone/);
        expect(description?.querySelector('.text-danger')).toHaveTextContent(/Permanently deletes their characters/);
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

    // Ruling 7: Button `loading` never sets native `disabled` (focus stays), so the
    // equivalent-strength proof is aria-disabled + aria-busy + a swallowed click.
    it('marks the confirm button busy, names it "Banning..." and swallows the click while pending', () => {
        const { onConfirm } = renderModal(REAL_TARGET, vi.fn(), vi.fn(), true);
        const confirm = screen.getByRole('button', { name: 'Banning...' });
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
const banDialog = () => screen.getByRole('dialog', { name: 'Ban Alice' });
const reasonField = () => screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
const typeReason = (value: string) => fireEvent.change(reasonField(), { target: { value } });

const CLOSE_PATHS: Array<[string, () => void]> = [
    ['Escape', () => { fireEvent.keyDown(document, { key: 'Escape' }); }],
    ['×', () => { fireEvent.click(within(banDialog()).getByRole('button', { name: 'Close modal' })); }],
    ['the backdrop', () => {
        fireEvent.click(banDialog().parentElement!.querySelector('[aria-hidden="true"]') as HTMLElement);
    }],
];

describe('BanUserModal — dirty-close guard (ROK-1655)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('with a typed reason, Escape asks; Keep editing keeps the reason and does not close', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('cheating');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText(CONFIRM), 'a dirty Escape must ask to discard').not.toBeNull();
        expect(onClose, 'a dirty Escape must not close').not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(reasonField(), 'Keep must leave the typed reason in place').toHaveValue('cheating');
    });

    it('with a typed reason, Discard calls onClose', () => {
        const { onClose } = renderModal(REAL_TARGET);
        typeReason('cheating');
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
        typeReason('cheating');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText(CONFIRM), 'an explicit Cancel is guarded (ruling 4)').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('BanUserModal — pinned footer (ROK-1655)', () => {
    it('Cancel and Ban sit in the modal-footer, outside the scrolling body', () => {
        renderModal(REAL_TARGET);
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'the Modal must render its pinned footer').not.toBeNull();
        expect(footer!, 'Ban must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Ban' }));
        expect(footer!, 'Cancel must be in the pinned footer').toContainElement(screen.getByRole('button', { name: 'Cancel' }));
        const body = footer!.previousElementSibling as HTMLElement;
        expect(body).toContainElement(reasonField());
        expect(body, 'the scroll body must not hold Ban').not.toContainElement(screen.getByRole('button', { name: 'Ban' }));
    });
});
