import type { JSX } from 'react';
import { useState } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import type { CronJobDto } from '@raid-ledger/contract';
import { useCronJobs } from '../../hooks/use-cron-jobs';
import { useTimezoneStore } from '../../stores/timezone-store';
import { Button } from '../../components/ui/button';
import { RadioGroup } from '../../components/ui/radio-group';
import { Select } from '../../components/ui/select';
import { formatJobName } from '../cron-jobs/cron-utils';
import { JobCard } from '../cron-jobs/CronJobCard';
import { ExecutionHistoryModal, EditScheduleModal } from '../cron-jobs/CronJobModals';

type SortOption = 'name' | 'theme' | 'status';

/**
 * Admin panel: Scheduled Jobs Manager (ROK-310).
 * Card layout showing all registered cron jobs with pause/resume,
 * execution history, and schedule editing.
 */
function getThemes(data: CronJobDto[] | undefined): string[] {
    return data ? [...new Set(data.map((j) => j.category))].sort() : [];
}

function sortJobs(jobs: CronJobDto[], sortBy: SortOption): CronJobDto[] {
    return [...jobs].sort((a, b) => {
        if (sortBy === 'theme') return a.category.localeCompare(b.category);
        if (sortBy === 'status') return (a.paused ? 1 : 0) - (b.paused ? 1 : 0);
        return formatJobName(a.name).localeCompare(formatJobName(b.name));
    });
}

function filterJobs(
    data: CronJobDto[] | undefined,
    activeTheme: string | null,
    aiOnly: boolean,
    sortBy: SortOption,
): CronJobDto[] {
    if (!data) return [];
    const filtered = data.filter((job) => {
        if (activeTheme && job.category !== activeTheme) return false;
        if (aiOnly && !job.usesAi) return false;
        return true;
    });
    return sortJobs(filtered, sortBy);
}

function CronJobGrid({ jobs, tz, pauseJob, resumeJob, runJob, onHistory, onEdit }: {
    jobs: CronJobDto[]; tz: string; pauseJob: ReturnType<typeof useCronJobs>['pauseJob'];
    resumeJob: ReturnType<typeof useCronJobs>['resumeJob']; runJob: ReturnType<typeof useCronJobs>['runJob'];
    onHistory: (job: CronJobDto) => void; onEdit: (job: CronJobDto) => void;
}) {
    if (jobs.length === 0) return null;
    return (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {jobs.map((job) => (
                <JobCard key={job.id} job={job} tz={tz} onViewHistory={() => onHistory(job)} onEditSchedule={() => onEdit(job)}
                    onRun={() => runJob.mutate(job.id)} onPause={() => pauseJob.mutate(job.id)} onResume={() => resumeJob.mutate(job.id)}
                    isPausing={pauseJob.isPending && pauseJob.variables === job.id}
                    isResuming={resumeJob.isPending && resumeJob.variables === job.id}
                    isRunning={runJob.isPending && runJob.variables === job.id} />
            ))}
        </div>
    );
}

export function CronJobsPanel() {
    const { cronJobs, pauseJob, resumeJob, runJob } = useCronJobs();
    const tz = useTimezoneStore((s) => s.resolved);
    const [historyJob, setHistoryJob] = useState<CronJobDto | null>(null);
    const [editJob, setEditJob] = useState<CronJobDto | null>(null);
    const [activeTheme, setActiveTheme] = useState<string | null>(null);
    const [aiOnly, setAiOnly] = useState<boolean>(false);
    const [sortBy, setSortBy] = useState<SortOption>('name');

    const filteredJobs = filterJobs(cronJobs.data, activeTheme, aiOnly, sortBy);

    return (
        <div className="space-y-6">
            <div><h2 className="text-xl font-semibold text-foreground">Scheduled Jobs</h2>
                <p className="text-sm text-muted mt-1">Monitor and manage all scheduled jobs. Pause, resume, view execution history, or edit schedules.</p></div>
            <FilterToolbar data={cronJobs.data} allThemes={getThemes(cronJobs.data)} activeTheme={activeTheme} onThemeChange={setActiveTheme} aiOnly={aiOnly} onAiToggle={setAiOnly} sortBy={sortBy} onSortChange={setSortBy} />
            <CronJobStates isLoading={cronJobs.isLoading} isError={cronJobs.isError} isEmpty={cronJobs.data?.length === 0} />
            <CronJobGrid jobs={filteredJobs} tz={tz} pauseJob={pauseJob} resumeJob={resumeJob} runJob={runJob} onHistory={setHistoryJob} onEdit={setEditJob} />
            {cronJobs.data && cronJobs.data.length > 0 && filteredJobs.length === 0 && <div className="py-12 text-center text-muted text-sm">No jobs match the selected filter.</div>}
            {historyJob && <ExecutionHistoryModal job={historyJob} onClose={() => setHistoryJob(null)} />}
            {editJob && <EditScheduleModal job={editJob} onClose={() => setEditJob(null)} />}
        </div>
    );
}

/** Filter + Sort toolbar */
function FilterToolbar({ data, allThemes, activeTheme, onThemeChange, aiOnly, onAiToggle, sortBy, onSortChange }: {
    data: CronJobDto[] | undefined; allThemes: string[]; activeTheme: string | null;
    onThemeChange: (theme: string | null) => void;
    aiOnly: boolean; onAiToggle: (next: boolean) => void;
    sortBy: SortOption; onSortChange: (sort: SortOption) => void;
}): JSX.Element | null {
    if (!data || data.length === 0) return null;
    const aiCount = data.filter((j) => j.usesAi).length;

    return (
        <div className="flex flex-wrap items-center gap-3">
            <ThemeFilter data={data} allThemes={allThemes} activeTheme={activeTheme} onThemeChange={onThemeChange} />
            {aiCount > 0 && (
                <Button size="sm" variant={aiOnly ? 'secondary' : 'ghost'} aria-pressed={aiOnly}
                    onClick={() => onAiToggle(!aiOnly)} title="Show only jobs that issue LLM calls">
                    <SparklesIcon className="h-4 w-4" aria-hidden />
                    AI ({aiCount})
                </Button>
            )}
            <div className="flex-1" />
            <Select fieldSize="sm" aria-label="Sort jobs" wrapperClassName="w-auto" value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortOption)}>
                <option value="name">Sort: Name</option>
                <option value="theme">Sort: Theme</option>
                <option value="status">Sort: Status</option>
            </Select>
        </div>
    );
}

/** The radio value standing for "no theme filter" (activeTheme === null). */
const ALL_THEMES = '__all__';

/**
 * Theme filter — a segmented RadioGroup (ROK-1653 ruling 6). 'All' is the
 * reset, so re-clicking the checked theme no longer clears it. The row
 * scrolls sideways inside its own box when the themes outgrow a phone.
 */
function ThemeFilter({ data, allThemes, activeTheme, onThemeChange }: {
    data: CronJobDto[]; allThemes: string[]; activeTheme: string | null; onThemeChange: (theme: string | null) => void;
}): JSX.Element {
    const count = (theme: string) => data.filter((j) => j.category === theme).length;
    const options = [
        { value: ALL_THEMES, label: `All (${data.length})` },
        ...allThemes.map((theme) => ({ value: theme, label: `${theme} (${count(theme)})` })),
    ];
    return (
        <div className="max-w-full overflow-x-auto">
            <RadioGroup appearance="segmented" label="Filter by theme" hideLabel options={options}
                className="[&_label]:whitespace-nowrap" value={activeTheme ?? ALL_THEMES}
                onChange={(v) => onThemeChange(v === ALL_THEMES ? null : v)} />
        </div>
    );
}

/** Loading, error, and empty states for cron jobs */
function CronJobStates({ isLoading, isError, isEmpty }: {
    isLoading: boolean;
    isError: boolean;
    isEmpty: boolean | undefined;
}): JSX.Element | null {
    if (isLoading) {
        return <div className="py-12 text-center text-muted text-sm">Loading scheduled jobs...</div>;
    }
    if (isError) {
        return (
            <div className="py-12 text-center text-danger text-sm">
                Failed to load scheduled jobs. Please try again.
            </div>
        );
    }
    if (isEmpty) {
        return (
            <div className="py-12 text-center text-muted text-sm">
                No scheduled jobs registered yet. Jobs will appear after the first sync.
            </div>
        );
    }
    return null;
}
