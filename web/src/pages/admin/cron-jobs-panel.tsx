import { useState } from 'react';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { useCronJobs, useCronJobExecutions } from '../../hooks/use-cron-jobs';
import { useTimezoneStore } from '../../stores/timezone-store';

/** Known display titles for core cron jobs */
const JOB_TITLES: Record<string, string> = {
    IgdbService_handleScheduledSync: 'IGDB Game Sync',
    EventReminderService_handleDayOfReminders: 'Day-of Event Reminders',
    EventReminderService_handleStartingSoonReminders: 'Starting Soon Reminders',
    RelayService_handleHeartbeat: 'Relay Heartbeat',
    VersionCheckService_handleCron: 'Version Check',
};

/** Theme categorization for cron jobs */
const JOB_THEMES: Record<string, string> = {
    IgdbService_handleScheduledSync: 'Data Sync',
    EventReminderService_handleDayOfReminders: 'Notifications',
    EventReminderService_handleStartingSoonReminders: 'Notifications',
    RelayService_handleHeartbeat: 'Monitoring',
    VersionCheckService_handleCron: 'Monitoring',
};

/** Derive theme from job name */
function getJobTheme(name: string): string {
    if (JOB_THEMES[name]) return JOB_THEMES[name];
    // Plugin jobs containing 'sync' are Data Sync, others default to 'Plugin'
    if (name.includes(':')) {
        return name.toLowerCase().includes('sync') ? 'Data Sync' : 'Plugin';
    }
    return 'Other';
}

/** Theme colors */
const THEME_COLORS: Record<string, string> = {
    'Notifications': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    'Data Sync': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    'Monitoring': 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    'Plugin': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    'Other': 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

type SortOption = 'name' | 'theme' | 'status';

/** Get a user-friendly display title from the registry name */
function formatJobName(name: string): string {
    // Check explicit titles first
    if (JOB_TITLES[name]) return JOB_TITLES[name];

    // Plugin jobs: "blizzard:character-auto-sync" → "Character Auto Sync"
    if (name.includes(':')) {
        return name
            .split(':')[1]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Fallback: "SomeService_handleFoo" → "Foo"
    return name
        .replace(/^\w+Service_/, '')
        .replace(/^handle/, '')
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Interval presets for the schedule editor */
const INTERVAL_PRESETS = [
    { label: 'Every 5 minutes', value: '0 */5 * * * *' },
    { label: 'Every 15 minutes', value: '0 */15 * * * *' },
    { label: 'Every 30 minutes', value: '0 */30 * * * *' },
    { label: 'Every hour', value: '0 0 * * * *' },
    { label: 'Every 6 hours', value: '0 0 */6 * * *' },
    { label: 'Every day at midnight', value: '0 0 0 * * *' },
    { label: 'Every week (Sunday midnight)', value: '0 0 0 * * 0' },
];

/** Format a date string in the user's timezone */
function formatTimestamp(isoString: string | null, tz: string): string {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleString('en-US', {
            timeZone: tz,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    } catch {
        return new Date(isoString).toLocaleString();
    }
}

/** Format duration in ms to human-readable */
function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}

/** Source badge component */
function SourceBadge({ source, pluginSlug }: { source: string; pluginSlug: string | null }) {
    const colors: Record<string, string> = {
        core: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        plugin: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    };
    const label = source === 'plugin' && pluginSlug ? pluginSlug : source;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${colors[source] || colors.core}`}>
            {label}
        </span>
    );
}

/** Execution status badge */
function ExecutionStatusBadge({ status }: { status: string }) {
    const styles: Record<string, string> = {
        completed: 'text-green-400',
        failed: 'text-red-400',
        skipped: 'text-yellow-400',
    };
    return <span className={`text-xs font-medium ${styles[status] || 'text-muted'}`}>{status}</span>;
}

// ─── Job Card ─────────────────────────────────────────────────────

function JobCard({
    job,
    tz,
    onViewHistory,
    onEditSchedule,
    onRun,
    onPause,
    onResume,
    isPausing,
    isResuming,
    isRunning,
}: {
    job: CronJobDto;
    tz: string;
    onViewHistory: () => void;
    onEditSchedule: () => void;
    onRun: () => void;
    onPause: () => void;
    onResume: () => void;
    isPausing: boolean;
    isResuming: boolean;
    isRunning: boolean;
}) {
    return (
        <div className="bg-panel/50 border border-edge/50 rounded-xl p-4 hover:border-edge/80 transition-colors">
            {/* Top row: title + status */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground leading-snug">
                        {formatJobName(job.name)}
                    </h3>
                    {job.description && (
                        <p className="text-xs text-muted mt-0.5">{job.description}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {(() => {
                        const theme = getJobTheme(job.name);
                        return (
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${THEME_COLORS[theme] || THEME_COLORS['Other']}`}>
                                {theme}
                            </span>
                        );
                    })()}
                    <SourceBadge source={job.source} pluginSlug={job.pluginSlug} />
                    {job.paused ? (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            Paused
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                            Active
                        </span>
                    )}
                </div>
            </div>

            {/* Info row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mb-3">
                <span title="Cron expression">
                    <span className="text-secondary">Schedule:</span>{' '}
                    <span className="font-mono">{job.cronExpression}</span>
                </span>
                <span>
                    <span className="text-secondary">Last run:</span>{' '}
                    {formatTimestamp(job.lastRunAt, tz)}
                </span>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-2 pt-2 border-t border-edge/30">
                <button
                    onClick={onViewHistory}
                    className="px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground bg-surface/50 hover:bg-surface border border-edge rounded-lg transition-colors"
                >
                    History
                </button>
                <button
                    onClick={onEditSchedule}
                    className="px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground bg-surface/50 hover:bg-surface border border-edge rounded-lg transition-colors"
                >
                    Schedule
                </button>
                <button
                    onClick={onRun}
                    disabled={isRunning}
                    className="px-3 py-1.5 text-xs font-medium text-accent hover:text-accent/80 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors disabled:opacity-50"
                >
                    {isRunning ? 'Running…' : 'Run Now'}
                </button>
                <div className="flex-1" />
                {job.paused ? (
                    <button
                        onClick={onResume}
                        disabled={isResuming}
                        className="px-3 py-1.5 text-xs font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Resume
                    </button>
                ) : (
                    <button
                        onClick={onPause}
                        disabled={isPausing}
                        className="px-3 py-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Pause
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Execution History Modal ──────────────────────────────────────

function ExecutionHistoryModal({
    job,
    onClose,
}: {
    job: CronJobDto;
    onClose: () => void;
}) {
    const { data: executions, isLoading } = useCronJobExecutions(job.id);
    const tz = useTimezoneStore((s) => s.resolved);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-panel border border-edge rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-edge/50">
                    <div>
                        <h3 className="text-lg font-semibold text-foreground">Execution History</h3>
                        <p className="text-sm text-muted mt-0.5">{job.description || job.name}</p>
                    </div>
                    <button onClick={onClose} className="text-muted hover:text-foreground transition-colors text-xl">
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto max-h-[60vh] p-4">
                    {isLoading && <p className="text-muted text-sm text-center py-8">Loading...</p>}
                    {!isLoading && (!executions || executions.length === 0) && (
                        <p className="text-muted text-sm text-center py-8">No executions recorded yet.</p>
                    )}
                    {executions && executions.length > 0 && (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase text-muted border-b border-edge/30">
                                    <th className="pb-2 pr-4">Status</th>
                                    <th className="pb-2 pr-4">Started</th>
                                    <th className="pb-2 pr-4">Duration</th>
                                    <th className="pb-2">Error</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-edge/20">
                                {executions.map((exec: CronJobExecutionDto) => (
                                    <tr key={exec.id} className="hover:bg-surface/30 transition-colors">
                                        <td className="py-2 pr-4">
                                            <ExecutionStatusBadge status={exec.status} />
                                        </td>
                                        <td className="py-2 pr-4 text-muted">{formatTimestamp(exec.startedAt, tz)}</td>
                                        <td className="py-2 pr-4 text-muted">{formatDuration(exec.durationMs)}</td>
                                        <td className="py-2 text-red-400 text-xs truncate max-w-[200px]" title={exec.error || ''}>
                                            {exec.error || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Edit Schedule Modal ──────────────────────────────────────────

function EditScheduleModal({
    job,
    onClose,
}: {
    job: CronJobDto;
    onClose: () => void;
}) {
    const { updateSchedule } = useCronJobs();
    const [selectedExpression, setSelectedExpression] = useState(job.cronExpression);

    const handleSave = () => {
        updateSchedule.mutate(
            { id: job.id, cronExpression: selectedExpression },
            { onSuccess: () => onClose() },
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-panel border border-edge rounded-xl shadow-xl w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-edge/50">
                    <h3 className="text-lg font-semibold text-foreground">Edit Schedule</h3>
                    <button onClick={onClose} className="text-muted hover:text-foreground transition-colors text-xl">
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">Interval</label>
                        <select
                            value={selectedExpression}
                            onChange={(e) => setSelectedExpression(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-edge rounded-lg text-foreground text-sm focus:ring-2 focus:ring-accent/50 focus:border-accent"
                        >
                            {INTERVAL_PRESETS.map((preset) => (
                                <option key={preset.value} value={preset.value}>
                                    {preset.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Restart warning */}
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                        <p className="text-xs text-yellow-400">
                            ⚠️ Schedule changes take effect immediately but will revert to the
                            original @Cron decorator schedule on application restart.
                        </p>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={updateSchedule.isPending || selectedExpression === job.cronExpression}
                            className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 rounded-lg text-white transition-colors disabled:opacity-50"
                        >
                            {updateSchedule.isPending ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Main Panel ───────────────────────────────────────────────────

/**
 * Admin panel: Scheduled Jobs Manager (ROK-310).
 * Card layout showing all registered cron jobs with pause/resume,
 * execution history, and schedule editing.
 */
export function CronJobsPanel() {
    const { cronJobs, pauseJob, resumeJob, runJob } = useCronJobs();
    const tz = useTimezoneStore((s) => s.resolved);
    const [historyJob, setHistoryJob] = useState<CronJobDto | null>(null);
    const [editJob, setEditJob] = useState<CronJobDto | null>(null);
    const [activeTheme, setActiveTheme] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<SortOption>('name');

    // Derive available themes from data
    const allThemes = cronJobs.data
        ? [...new Set(cronJobs.data.map((j: CronJobDto) => getJobTheme(j.name)))].sort()
        : [];

    // Filter + sort
    const filteredJobs = cronJobs.data
        ? cronJobs.data
            .filter((job: CronJobDto) => !activeTheme || getJobTheme(job.name) === activeTheme)
            .sort((a: CronJobDto, b: CronJobDto) => {
                if (sortBy === 'theme') return getJobTheme(a.name).localeCompare(getJobTheme(b.name));
                if (sortBy === 'status') return (a.paused ? 1 : 0) - (b.paused ? 1 : 0);
                return formatJobName(a.name).localeCompare(formatJobName(b.name));
            })
        : [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-foreground">Scheduled Jobs</h2>
                <p className="text-sm text-muted mt-1">
                    Monitor and manage all scheduled jobs. Pause, resume, view execution history, or edit schedules.
                </p>
            </div>

            {/* Filter + Sort toolbar */}
            {cronJobs.data && cronJobs.data.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    {/* Theme filter pills */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={() => setActiveTheme(null)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${activeTheme === null
                                ? 'bg-accent/20 text-accent border-accent/40'
                                : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                                }`}
                        >
                            All ({cronJobs.data.length})
                        </button>
                        {allThemes.map((theme) => {
                            const count = cronJobs.data!.filter((j: CronJobDto) => getJobTheme(j.name) === theme).length;
                            return (
                                <button
                                    key={theme}
                                    onClick={() => setActiveTheme(activeTheme === theme ? null : theme)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${activeTheme === theme
                                        ? (THEME_COLORS[theme] || THEME_COLORS['Other'])
                                        : 'bg-surface/50 text-muted border-edge hover:text-foreground'
                                        }`}
                                >
                                    {theme} ({count})
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex-1" />

                    {/* Sort dropdown */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="px-3 py-1.5 text-xs bg-surface/50 border border-edge rounded-lg text-muted focus:text-foreground focus:ring-1 focus:ring-accent/50"
                    >
                        <option value="name">Sort: Name</option>
                        <option value="theme">Sort: Theme</option>
                        <option value="status">Sort: Status</option>
                    </select>
                </div>
            )}

            {/* States */}
            {cronJobs.isLoading && (
                <div className="py-12 text-center text-muted text-sm">Loading scheduled jobs...</div>
            )}

            {cronJobs.isError && (
                <div className="py-12 text-center text-red-400 text-sm">
                    Failed to load scheduled jobs. Please try again.
                </div>
            )}

            {cronJobs.data && cronJobs.data.length === 0 && (
                <div className="py-12 text-center text-muted text-sm">
                    No scheduled jobs registered yet. Jobs will appear after the first sync.
                </div>
            )}

            {/* Card grid */}
            {filteredJobs.length > 0 && (
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                    {filteredJobs.map((job: CronJobDto) => (
                        <JobCard
                            key={job.id}
                            job={job}
                            tz={tz}
                            onViewHistory={() => setHistoryJob(job)}
                            onEditSchedule={() => setEditJob(job)}
                            onRun={() => runJob.mutate(job.id)}
                            onPause={() => pauseJob.mutate(job.id)}
                            onResume={() => resumeJob.mutate(job.id)}
                            isPausing={pauseJob.isPending && pauseJob.variables === job.id}
                            isResuming={resumeJob.isPending && resumeJob.variables === job.id}
                            isRunning={runJob.isPending && runJob.variables === job.id}
                        />
                    ))}
                </div>
            )}

            {/* Empty filter state */}
            {cronJobs.data && cronJobs.data.length > 0 && filteredJobs.length === 0 && (
                <div className="py-12 text-center text-muted text-sm">
                    No jobs match the selected filter.
                </div>
            )}

            {/* Modals */}
            {historyJob && <ExecutionHistoryModal job={historyJob} onClose={() => setHistoryJob(null)} />}
            {editJob && <EditScheduleModal job={editJob} onClose={() => setEditJob(null)} />}
        </div>
    );
}
