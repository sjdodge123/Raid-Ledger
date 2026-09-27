import type { JSX } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import type { CronJobDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
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

const PILL = 'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border';

/** Status badge (active/paused) — semantic, so the success/warning tokens. */
function StatusBadge({ paused }: { paused: boolean }): JSX.Element {
    if (paused) {
        return (
            <span className={`${PILL} bg-warning/10 text-warning border-warning/30`}>
                Paused
            </span>
        );
    }
    return (
        <span className={`${PILL} bg-success/10 text-success border-success/30`}>
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

function PauseResumeButton({ paused, onPause, onResume, isPausing, isResuming }: {
    paused: boolean; onPause: () => void; onResume: () => void; isPausing: boolean; isResuming: boolean;
}) {
    if (paused) {
        return <Button size="sm" variant="success-soft" onClick={onResume} disabled={isResuming}>Resume</Button>;
    }
    return <Button size="sm" variant="warning-soft" onClick={onPause} disabled={isPausing}>Pause</Button>;
}

/** Action buttons row for a job card */
function JobCardActions({ job, onViewHistory, onEditSchedule, onRun, onPause, onResume, isPausing, isResuming, isRunning }: Omit<JobCardProps, 'tz'>): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge/30">
            <Button size="sm" variant="secondary" onClick={onViewHistory}>History</Button>
            <Button size="sm" variant="secondary" onClick={onEditSchedule}>Schedule</Button>
            <Button size="sm" variant="success-soft" onClick={onRun} disabled={isRunning}>
                {isRunning ? 'Running...' : 'Run Now'}
            </Button>
            <div className="flex-1" />
            <PauseResumeButton paused={job.paused} onPause={onPause} onResume={onResume} isPausing={isPausing} isResuming={isResuming} />
        </div>
    );
}
