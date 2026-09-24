/**
 * ROK-1653 (G4b) — the cron job modals use the shared primitives: the Interval
 * select is named by a Field label (it had a bare <label> with no htmlFor), the
 * Save button is a loading Button (aria-busy, swallowed click), and both ✕
 * buttons are icon-only ghost Buttons named "Close".
 */
import { render, screen } from '@testing-library/react';
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

    it('closes from the icon-only Close button and from Cancel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<EditScheduleModal job={JOB} onClose={onClose} />);
        const close = screen.getByRole('button', { name: 'Close' });
        expect(close).toHaveAttribute('type', 'button');
        expect(close.querySelector('svg')).not.toBeNull();
        await user.click(close);
        expect(onClose).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('ExecutionHistoryModal (ROK-1653 G4b)', () => {
    it('closes from the icon-only Close button', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<ExecutionHistoryModal job={JOB} onClose={onClose} />);
        const close = screen.getByRole('button', { name: 'Close' });
        expect(close.querySelector('svg')).not.toBeNull();
        await user.click(close);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
