/**
 * ROK-1653 (G4b) — the cron job modals use the shared primitives: the Interval
 * select is named by a Field label (it had a bare <label> with no htmlFor) and
 * the Save button is a loading Button (aria-busy, swallowed click).
 * Tech-debt [28] — both are the shared `Modal` (role="dialog", aria-modal, named
 * by its title, focus trap), not a hand-rolled overlay; its × is "Close modal".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CronJobDto } from '@raid-ledger/contract';
import { EditScheduleModal, ExecutionHistoryModal } from './CronJobModals';

const h = vi.hoisted(() => ({ mutate: vi.fn(), pending: false }));

vi.mock('../../hooks/use-cron-jobs', () => ({
    useCronJobs: () => ({ updateSchedule: { mutate: h.mutate, isPending: h.pending } }),
    useCronJobExecutions: () => ({ data: [], isLoading: false }),
}));

const JOB: CronJobDto = {
    id: 7, name: 'Hourly_Sync', category: 'Data Sync', source: 'core', pluginSlug: null,
    cronExpression: '0 0 * * * *', description: 'Syncs things', paused: false,
    lastRunAt: null, nextRunAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
    h.mutate.mockReset();
    h.pending = false;
});

/** The shared Modal's scrim — the aria-hidden sibling of the dialog. */
function backdropOf(dialog: HTMLElement): HTMLElement {
    const backdrop = dialog.parentElement?.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
    if (!backdrop) throw new Error('no Modal backdrop beside the dialog');
    return backdrop;
}

describe('cron job modals are the shared Modal (tech-debt [28])', () => {
    it('EditScheduleModal is an aria-modal dialog named for the job', () => {
        render(<EditScheduleModal job={JOB} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Edit Schedule: Hourly Sync' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveTextContent('Syncs things');
    });

    it('ExecutionHistoryModal is an aria-modal dialog named "Execution History"', () => {
        render(<ExecutionHistoryModal job={JOB} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Execution History' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveTextContent('Syncs things');
        expect(dialog).toHaveTextContent('No executions recorded yet.');
    });

    it('a backdrop tap and Escape still close both (non-destructive)', () => {
        const onClose = vi.fn();
        const { unmount } = render(<ExecutionHistoryModal job={JOB} onClose={onClose} />);
        fireEvent.click(backdropOf(screen.getByRole('dialog')));
        expect(onClose).toHaveBeenCalledTimes(1);
        unmount();
        render(<EditScheduleModal job={JOB} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('EditScheduleModal (ROK-1653 G4b)', () => {
    it('names the interval select by its "Interval" label (a11y regression)', () => {
        render(<EditScheduleModal job={JOB} onClose={vi.fn()} />);
        const control = screen.getByLabelText('Interval');
        expect(control).toBe(screen.getByRole('combobox', { name: 'Interval' }));
        expect(control).toHaveValue('0 0 * * * *');
    });

    it('saves the newly chosen interval expression', async () => {
        const user = userEvent.setup();
        render(<EditScheduleModal job={JOB} onClose={vi.fn()} />);
        const save = screen.getByRole('button', { name: 'Save' });
        expect(save).toBeDisabled();
        await user.selectOptions(screen.getByLabelText('Interval'), 'Every 2 hours');
        expect(save).toBeEnabled();
        await user.click(save);
        expect(h.mutate).toHaveBeenCalledWith(
            { id: 7, cronExpression: '0 0 */2 * * *' }, expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });

    it('marks Save aria-busy while saving and swallows the click', async () => {
        h.pending = true;
        const user = userEvent.setup();
        render(<EditScheduleModal job={JOB} onClose={vi.fn()} />);
        await user.selectOptions(screen.getByLabelText('Interval'), 'Every 2 hours');
        const save = screen.getByRole('button', { name: /^sav/i });
        expect(save).toHaveAttribute('aria-busy', 'true');
        expect(save).toHaveAttribute('aria-disabled', 'true');
        expect(save).toHaveAccessibleName('Saving…');
        await user.click(save);
        expect(h.mutate).not.toHaveBeenCalled();
    });

    it('closes from the icon-only × and from Cancel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<EditScheduleModal job={JOB} onClose={onClose} />);
        // One ×, the Modal's own — the bespoke header "Close" button is gone.
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
        const close = screen.getByRole('button', { name: 'Close modal' });
        expect(close).toHaveAttribute('type', 'button');
        expect(close.querySelector('svg')).not.toBeNull();
        await user.click(close);
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('ExecutionHistoryModal (ROK-1653 G4b)', () => {
    it('closes from the icon-only ×', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<ExecutionHistoryModal job={JOB} onClose={onClose} />);
        expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
        const close = screen.getByRole('button', { name: 'Close modal' });
        expect(close.querySelector('svg')).not.toBeNull();
        await user.click(close);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
