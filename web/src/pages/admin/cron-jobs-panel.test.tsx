/**
 * ROK-1653 (ruling 6) — the Scheduled Jobs filter toolbar uses the shared
 * primitives: theme pills are a segmented RadioGroup (with 'All' as the
 * reset), the AI filter is a toggle Button carrying aria-pressed, and the sort
 * is a named Select.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CronJobDto } from '@raid-ledger/contract';
import { CronJobsPanel } from './cron-jobs-panel';

const mutation = () => ({ mutate: vi.fn(), isPending: false, variables: undefined });

function job(id: number, name: string, category: string, extra: Partial<CronJobDto> = {}): CronJobDto {
    return {
        id, name, category, source: 'core', pluginSlug: null, cronExpression: '0 * * * *',
        description: null, paused: false, lastRunAt: null, nextRunAt: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
    };
}

const JOBS: CronJobDto[] = [
    job(1, 'Alpha_Sync', 'Data Sync'),
    job(2, 'Bravo_Reminder', 'Notifications', { usesAi: true, paused: true }),
    job(3, 'Charlie_Digest', 'Notifications'),
];

vi.mock('../../hooks/use-cron-jobs', () => ({
    useCronJobs: () => ({
        cronJobs: { data: JOBS, isLoading: false, isError: false },
        pauseJob: mutation(), resumeJob: mutation(), runJob: mutation(),
    }),
}));

vi.mock('../cron-jobs/CronJobCard', () => ({
    JobCard: ({ job: j }: { job: CronJobDto }) => <h3>{j.name}</h3>,
}));

function shownJobs(): string[] {
    return screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
}

describe('CronJobsPanel filter toolbar (ROK-1653 ruling 6)', () => {
    beforeEach(() => render(<CronJobsPanel />));

    it('renders the theme filter as a named radiogroup with All (N) checked by default', () => {
        const group = screen.getByRole('radiogroup', { name: 'Filter by theme' });
        expect(within(group).getByRole('radio', { name: 'All (3)' })).toBeChecked();
        expect(within(group).getByRole('radio', { name: 'Data Sync (1)' })).not.toBeChecked();
        expect(within(group).getByRole('radio', { name: 'Notifications (2)' })).not.toBeChecked();
        expect(shownJobs()).toEqual(['Alpha_Sync', 'Bravo_Reminder', 'Charlie_Digest']);
    });

    it('checking a theme filters to it, and checking All resets the filter', async () => {
        const user = userEvent.setup();
        await user.click(screen.getByRole('radio', { name: 'Notifications (2)' }));
        expect(screen.getByRole('radio', { name: 'Notifications (2)' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'All (3)' })).not.toBeChecked();
        expect(shownJobs()).toEqual(['Bravo_Reminder', 'Charlie_Digest']);

        await user.click(screen.getByRole('radio', { name: 'All (3)' }));
        expect(screen.getByRole('radio', { name: 'All (3)' })).toBeChecked();
        expect(shownJobs()).toEqual(['Alpha_Sync', 'Bravo_Reminder', 'Charlie_Digest']);
    });

    it('the AI filter is a toggle button whose aria-pressed tracks the filter', async () => {
        const user = userEvent.setup();
        const ai = screen.getByRole('button', { name: 'AI (1)' });
        expect(ai).toHaveAttribute('aria-pressed', 'false');

        await user.click(ai);
        expect(ai).toHaveAttribute('aria-pressed', 'true');
        expect(shownJobs()).toEqual(['Bravo_Reminder']);

        await user.click(ai);
        expect(ai).toHaveAttribute('aria-pressed', 'false');
        expect(shownJobs()).toHaveLength(3);
    });

    it('the sort is a named combobox that reorders the jobs', async () => {
        const user = userEvent.setup();
        const sort = screen.getByRole('combobox', { name: 'Sort jobs' });
        expect(sort).toHaveValue('name');

        await user.selectOptions(sort, 'status');
        expect(shownJobs()).toEqual(['Alpha_Sync', 'Charlie_Digest', 'Bravo_Reminder']);
    });
});
