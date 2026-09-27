import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { DeleteModal, RestoreModal, ResetModal } from './backup-panel-modals';

vi.mock('../../lib/clipboard', () => ({ copyWithToast: vi.fn().mockResolvedValue(true) }));

const BACKUP: BackupFileDto = {
    filename: 'raid-ledger-2026-09-24.dump', type: 'daily', sizeBytes: 2048, createdAt: '2026-09-24T00:00:00.000Z',
};
const KEYWORD_FIELD = 'Type the confirmation keyword';
/** Ruling 9: the destructive paint is the danger token, never a raw red hue. */
const RAW_RED = /\b(?:bg|text|border)-red-\d/;

function confirmField() {
    return screen.getByRole('textbox', { name: KEYWORD_FIELD });
}

/** The shared Modal's scrim — the aria-hidden sibling of the dialog. */
function backdropOf(dialog: HTMLElement): HTMLElement {
    const backdrop = dialog.parentElement?.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
    if (!backdrop) throw new Error('no Modal backdrop beside the dialog');
    return backdrop;
}

function expectAriaModal(name: string): HTMLElement {
    const dialog = screen.getByRole('dialog', { name });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    return dialog;
}

describe('backup modals are the shared Modal (tech-debt [28])', () => {
    beforeEach(() => vi.clearAllMocks());

    it('each confirm is an aria-modal dialog named by its title', () => {
        const { unmount } = render(<DeleteModal backup={BACKUP} onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
        expect(expectAriaModal('Delete Backup')).toHaveTextContent(BACKUP.filename);
        unmount();
        const restore = render(<RestoreModal backup={BACKUP} onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
        expectAriaModal('Restore from Backup');
        restore.unmount();
        render(<ResetModal onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} result={null} />);
        expectAriaModal('Reset Instance');
    });

    it('a stray backdrop tap or Escape on a typed Restore confirm does not cancel it', () => {
        const onClose = vi.fn();
        render(<RestoreModal backup={BACKUP} onClose={onClose} onConfirm={vi.fn()} isPending={false} />);
        fireEvent.change(confirmField(), { target: { value: 'RESTO' } });
        fireEvent.click(backdropOf(expectAriaModal('Restore from Backup')));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(confirmField()).toHaveValue('RESTO');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a stray backdrop tap on a typed Reset confirm does not cancel it', () => {
        const onClose = vi.fn();
        render(<ResetModal onClose={onClose} onConfirm={vi.fn()} isPending={false} result={null} />);
        fireEvent.change(confirmField(), { target: { value: 'RES' } });
        fireEvent.click(backdropOf(expectAriaModal('Reset Instance')));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    });

    it('the one-time password view never closes on a stray backdrop tap', () => {
        const onClose = vi.fn();
        render(<ResetModal onClose={onClose} onConfirm={vi.fn()} isPending={false} result={{ password: 's3cret-pass' }} />);
        const dialog = expectAriaModal('Instance Reset Complete');
        expect(dialog).toHaveTextContent('s3cret-pass');
        fireEvent.click(backdropOf(dialog));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Discard your changes?' })).toHaveTextContent(/won't be shown again/);
        expect(screen.getByRole('dialog', { name: 'Instance Reset Complete' })).toHaveTextContent('s3cret-pass');
    });

    it('a pending Delete cannot be dismissed by the backdrop or ×', () => {
        const onClose = vi.fn();
        render(<DeleteModal backup={BACKUP} onClose={onClose} onConfirm={vi.fn()} isPending />);
        fireEvent.click(backdropOf(expectAriaModal('Delete Backup')));
        fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('RestoreModal — keyword confirm', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps Restore disabled until RESTORE is typed into the labelled field, then confirms', () => {
        const onConfirm = vi.fn();
        render(<RestoreModal backup={BACKUP} onClose={vi.fn()} onConfirm={onConfirm} isPending={false} />);
        const input = confirmField();
        expect(input).toHaveFocus();
        expect(input).toHaveAccessibleDescription('Type RESTORE to confirm');
        const confirm = screen.getByRole('button', { name: 'Restore Database' });
        expect(confirm).toBeDisabled();
        fireEvent.change(input, { target: { value: 'restore' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(input, { target: { value: 'RESTORE' } });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('paints the confirm and warning with the danger token, not a raw red', () => {
        render(<RestoreModal backup={BACKUP} onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} />);
        expect(screen.getByRole('button', { name: 'Restore Database' })).toHaveClass('text-danger');
        expect(screen.getByRole('dialog')).toHaveTextContent('Warning: This is a destructive operation');
        expect(document.body.innerHTML).not.toMatch(RAW_RED);
    });
});

describe('ResetModal — keyword confirm', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps Reset Instance disabled until RESET is typed into the labelled field, then confirms', () => {
        const onConfirm = vi.fn();
        render(<ResetModal onClose={vi.fn()} onConfirm={onConfirm} isPending={false} result={null} />);
        const input = confirmField();
        expect(input).toHaveAccessibleDescription('Type RESET to confirm');
        const confirm = screen.getByRole('button', { name: 'Reset Instance' });
        expect(confirm).toBeDisabled();
        fireEvent.change(input, { target: { value: 'RESET' } });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('dialog')).toHaveTextContent('This will permanently delete ALL data');
        expect(document.body.innerHTML).not.toMatch(RAW_RED);
    });

    it('Copy on the result view switches to Copied!', async () => {
        render(<ResetModal onClose={vi.fn()} onConfirm={vi.fn()} isPending={false} result={{ password: 's3cret-pass' }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
        expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go to Login' })).toBeInTheDocument();
    });
});

describe('DeleteModal — actions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('Cancel calls onClose', () => {
        const onClose = vi.fn();
        render(<DeleteModal backup={BACKUP} onClose={onClose} onConfirm={vi.fn()} isPending={false} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a pending Delete is aria-busy + aria-disabled and swallows a click (ruling 7)', () => {
        const onConfirm = vi.fn();
        render(<DeleteModal backup={BACKUP} onClose={vi.fn()} onConfirm={onConfirm} isPending />);
        const confirm = screen.getByRole('button', { name: 'Deleting...' });
        expect(confirm).toHaveAttribute('aria-busy', 'true');
        expect(confirm).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
