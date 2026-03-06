import { useState } from 'react';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { useCronJobs, useCronJobExecutions } from '../../hooks/use-cron-jobs';
import { useTimezoneStore } from '../../stores/timezone-store';
import { formatJobName, formatTimestamp, formatDuration, normalizeCron, getCronLabel, INTERVAL_PRESETS } from './cron-utils';

/** Execution status badge */
function ExecutionStatusBadge({ status }: { status: string }): JSX.Element {
    const styles: Record<string, string> = {
        completed: 'text-green-400',
        failed: 'text-red-400',
        skipped: 'text-yellow-400',
    };
    return <span className={`text-xs font-medium ${styles[status] || 'text-muted'}`}>{status}</span>;
}

/** Execution history modal for a cron job */
// eslint-disable-next-line max-lines-per-function
export function ExecutionHistoryModal({
    job,
    onClose,
}: {
    job: CronJobDto;
    onClose: () => void;
}): JSX.Element {
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
                        &#10005;
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto max-h-[60vh] p-4">
                    {isLoading && <p className="text-muted text-sm text-center py-8">Loading...</p>}
                    {!isLoading && (!executions || executions.length === 0) && (
                        <p className="text-muted text-sm text-center py-8">No executions recorded yet.</p>
                    )}
                    {executions && executions.length > 0 && (
                        <ExecutionTable executions={executions} tz={tz} />
                    )}
                </div>
            </div>
        </div>
    );
}

/** Execution history table */
function ExecutionTable({ executions, tz }: { executions: CronJobExecutionDto[]; tz: string }): JSX.Element {
    return (
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
                            {exec.error || '\u2014'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Edit schedule modal for a cron job */
// eslint-disable-next-line max-lines-per-function
export function EditScheduleModal({
    job,
    onClose,
}: {
    job: CronJobDto;
    onClose: () => void;
}): JSX.Element {
    const { updateSchedule } = useCronJobs();
    const tz = useTimezoneStore((s) => s.resolved);
    const normalizedExpression = normalizeCron(job.cronExpression);
    const [selectedExpression, setSelectedExpression] = useState(
        INTERVAL_PRESETS.some(p => p.value === normalizedExpression) ? normalizedExpression : job.cronExpression,
    );

    const isCustomExpression = !INTERVAL_PRESETS.some(
        (preset) => preset.value === normalizedExpression,
    );

    const handleSave = (): void => {
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
                <EditScheduleHeader job={job} onClose={onClose} />
                <EditScheduleBody
                    job={job}
                    tz={tz}
                    selectedExpression={selectedExpression}
                    isCustomExpression={isCustomExpression}
                    normalizedExpression={normalizedExpression}
                    onExpressionChange={setSelectedExpression}
                    onSave={handleSave}
                    onClose={onClose}
                    isSaving={updateSchedule.isPending}
                />
            </div>
        </div>
    );
}

/** Header for the edit schedule modal */
function EditScheduleHeader({ job, onClose }: { job: CronJobDto; onClose: () => void }): JSX.Element {
    return (
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge/50">
            <div>
                <p className="text-xs font-medium text-muted uppercase tracking-wide">Edit Schedule</p>
                <h3 className="text-lg font-semibold text-foreground">{formatJobName(job.name)}</h3>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-muted hover:text-foreground transition-colors text-xl">
                &#10005;
            </button>
        </div>
    );
}

/** Body for the edit schedule modal */
// eslint-disable-next-line max-lines-per-function
function EditScheduleBody({
    job, tz, selectedExpression, isCustomExpression, normalizedExpression,
    onExpressionChange, onSave, onClose, isSaving,
}: {
    job: CronJobDto;
    tz: string;
    selectedExpression: string;
    isCustomExpression: boolean;
    normalizedExpression: string;
    onExpressionChange: (expr: string) => void;
    onSave: () => void;
    onClose: () => void;
    isSaving: boolean;
}): JSX.Element {
    return (
        <div className="p-6 space-y-4">
            {job.description && (
                <p className="text-sm text-muted -mt-1">{job.description}</p>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <span className="block text-xs text-muted mb-0.5">Last Run</span>
                    <span className="text-foreground">{formatTimestamp(job.lastRunAt, tz)}</span>
                </div>
                <div>
                    <span className="block text-xs text-muted mb-0.5">Next Run</span>
                    <span className="text-foreground">{formatTimestamp(job.nextRunAt, tz)}</span>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-foreground mb-2">Interval</label>
                <select
                    value={selectedExpression}
                    onChange={(e) => onExpressionChange(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-edge rounded-lg text-foreground text-sm focus:ring-2 focus:ring-accent/50 focus:border-accent"
                >
                    {isCustomExpression && (
                        <option value={job.cronExpression}>
                            {getCronLabel(job.cronExpression)}
                        </option>
                    )}
                    {INTERVAL_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                            {preset.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-400">
                    Schedule changes take effect immediately but will revert to the
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
                    onClick={onSave}
                    disabled={isSaving || selectedExpression === job.cronExpression || selectedExpression === normalizedExpression}
                    className="px-4 py-2 text-sm font-medium bg-accent hover:bg-accent/80 rounded-lg text-white transition-colors disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
}
