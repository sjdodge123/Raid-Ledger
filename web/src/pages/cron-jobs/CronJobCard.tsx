import type { JSX } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import type { CronJobDto } from '@raid-ledger/contract';
import { formatJobName, getCronLabel, formatTimestamp, THEME_COLORS } from './cron-utils';

/** Emerald sparkles pill — marks a cron that issues LLM calls. */
function AiBadge(): JSX.Element {
    return (
        <span
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
            title="This job issues LLM calls"
        >
            <SparklesIcon className="h-3 w-3" aria-hidden />
            AI
        </span>
    );
}

/** Source badge component */
function SourceBadge({ source, pluginSlug }: { source: string; pluginSlug: string | null }): JSX.Element {
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

/** Status badge (active/paused) */
function StatusBadge({ paused }: { paused: boolean }): JSX.Element {
    if (paused) {
        return (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                Paused
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
            Active
        </span>
    );
}

interface JobCardProps {
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
}

function JobCardHeader({ job }: { job: CronJobDto }) {
    return (
        <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground leading-snug">{formatJobName(job.name)}</h3>
                {job.description && <p className="text-xs text-muted mt-0.5">{job.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {job.usesAi && <AiBadge />}
                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${THEME_COLORS[job.category] || THEME_COLORS['Other']}`}>{job.category}</span>
                <SourceBadge source={job.source} pluginSlug={job.pluginSlug} />
                <StatusBadge paused={job.paused} />
            </div>
        </div>
    );
}

function JobCardInfo({ job, tz }: { job: CronJobDto; tz: string }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mb-3">
            <span title={job.cronExpression}><span className="text-secondary">Schedule:</span> {getCronLabel(job.cronExpression)}</span>
            <span><span className="text-secondary">Last run:</span> {formatTimestamp(job.lastRunAt, tz)}</span>
        </div>
    );
}

/** Individual cron job card with info and action buttons */
export function JobCard({ job, tz, onViewHistory, onEditSchedule, onRun, onPause, onResume, isPausing, isResuming, isRunning }: JobCardProps): JSX.Element {
    return (
        <div className="bg-panel/50 border border-edge/50 rounded-xl p-4 hover:border-edge/80 transition-colors">
            <JobCardHeader job={job} />
            <JobCardInfo job={job} tz={tz} />
            <JobCardActions job={job} onViewHistory={onViewHistory} onEditSchedule={onEditSchedule} onRun={onRun}
                onPause={onPause} onResume={onResume} isPausing={isPausing} isResuming={isResuming} isRunning={isRunning} />
        </div>
    );
}

const ACTION_BTN = 'px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground bg-surface/50 hover:bg-surface border border-edge rounded-lg transition-colors';

function PauseResumeButton({ paused, onPause, onResume, isPausing, isResuming }: {
    paused: boolean; onPause: () => void; onResume: () => void; isPausing: boolean; isResuming: boolean;
}) {
    if (paused) {
        return <button onClick={onResume} disabled={isResuming} className="px-3 py-1.5 text-xs font-medium text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-lg transition-colors disabled:opacity-50">Resume</button>;
    }
    return <button onClick={onPause} disabled={isPausing} className="px-3 py-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 rounded-lg transition-colors disabled:opacity-50">Pause</button>;
}

/** Action buttons row for a job card */
function JobCardActions({ job, onViewHistory, onEditSchedule, onRun, onPause, onResume, isPausing, isResuming, isRunning }: Omit<JobCardProps, 'tz'>): JSX.Element {
    return (
        <div className="flex items-center gap-2 pt-2 border-t border-edge/30">
            <button onClick={onViewHistory} className={ACTION_BTN}>History</button>
            <button onClick={onEditSchedule} className={ACTION_BTN}>Schedule</button>
            <button onClick={onRun} disabled={isRunning} className="px-3 py-1.5 text-xs font-medium text-accent hover:text-accent/80 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg transition-colors disabled:opacity-50">
                {isRunning ? 'Running...' : 'Run Now'}
            </button>
            <div className="flex-1" />
            <PauseResumeButton paused={job.paused} onPause={onPause} onResume={onResume} isPausing={isPausing} isResuming={isResuming} />
        </div>
    );
}
