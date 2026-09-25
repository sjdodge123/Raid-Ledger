import type { JSX } from 'react';
import { useState } from 'react';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { useCronJobs, useCronJobExecutions } from '../../hooks/use-cron-jobs';
import { useTimezoneStore } from '../../stores/timezone-store';
import { formatJobName, formatTimestamp, formatDuration, normalizeCron, getCronLabel, INTERVAL_PRESETS } from './cron-utils';

/** Execution status badge */
function ExecutionStatusBadge({ status }: { status: string }): JSX.Element {
    const styles: Record<string, string> = {
        completed: 'text-success',
        failed: 'text-danger',
        skipped: 'text-warning',
        degraded: 'text-warning',
    };
    return <span className={`text-xs font-medium ${styles[status] || 'text-muted'}`}>{status}</span>;
}

/** Execution history modal for a cron job */
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
                <ExecutionHistoryHeader job={job} onClose={onClose} />
                <ExecutionHistoryBody executions={executions} isLoading={isLoading} tz={tz} />
            </div>
        </div>
    );
}

function ExecutionHistoryHeader({ job, onClose }: { job: CronJobDto; onClose: () => void }): JSX.Element {
    return (
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge/50">
            <div>
                <h3 className="text-lg font-semibold text-foreground">Execution History</h3>
                <p className="text-sm text-muted mt-0.5">{job.description || job.name}</p>
            </div>
            <CloseButton onClose={onClose} />
        </div>
    );
}

function CloseButton({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
        </Button>
    );
}

function ExecutionHistoryBody({ executions, isLoading, tz }: {
    executions: CronJobExecutionDto[] | undefined; isLoading: boolean; tz: string;
}): JSX.Element {
    return (
        <div className="overflow-y-auto max-h-[60vh] p-4">
            {isLoading && <p className="text-muted text-sm text-center py-8">Loading...</p>}
            {!isLoading && (!executions || executions.length === 0) && (
                <p className="text-muted text-sm text-center py-8">No executions recorded yet.</p>
            )}
            {executions && executions.length > 0 && <ExecutionTable executions={executions} tz={tz} />}
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
                        <td className="py-2 text-danger text-xs truncate max-w-[200px]" title={exec.error || ''}>
                            {exec.error || '\u2014'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Edit schedule modal for a cron job */
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
    const isCustomExpression = !INTERVAL_PRESETS.some((preset) => preset.value === normalizedExpression);

    const handleSave = (): void => {
        updateSchedule.mutate({ id: job.id, cronExpression: selectedExpression }, { onSuccess: () => onClose() });
    };

    return (
        <EditScheduleOverlay onClose={onClose}>
            <EditScheduleHeader job={job} onClose={onClose} />
            <EditScheduleBody job={job} tz={tz} selectedExpression={selectedExpression}
                isCustomExpression={isCustomExpression} normalizedExpression={normalizedExpression}
                onExpressionChange={setSelectedExpression} onSave={handleSave}
                onClose={onClose} isSaving={updateSchedule.isPending} />
        </EditScheduleOverlay>
    );
}

function EditScheduleOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-panel border border-edge rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                {children}
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
            <CloseButton onClose={onClose} />
        </div>
    );
}

/** Body for the edit schedule modal */
function EditScheduleBody({
    job, tz, selectedExpression, isCustomExpression, normalizedExpression,
    onExpressionChange, onSave, onClose, isSaving,
}: {
    job: CronJobDto; tz: string; selectedExpression: string; isCustomExpression: boolean;
    normalizedExpression: string; onExpressionChange: (expr: string) => void;
    onSave: () => void; onClose: () => void; isSaving: boolean;
}): JSX.Element {
    return (
        <div className="p-6 space-y-4">
            {job.description && <p className="text-sm text-muted -mt-1">{job.description}</p>}
            <RunTimesGrid job={job} tz={tz} />
            <IntervalSelector selectedExpression={selectedExpression} onExpressionChange={onExpressionChange}
                isCustomExpression={isCustomExpression} jobExpression={job.cronExpression} />
            <ScheduleRevertWarning />
            <ScheduleActions onClose={onClose} onSave={onSave} isSaving={isSaving}
                disabled={selectedExpression === job.cronExpression || selectedExpression === normalizedExpression} />
        </div>
    );
}

function RunTimesGrid({ job, tz }: { job: CronJobDto; tz: string }): JSX.Element {
    return (
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
    );
}

function IntervalSelector({ selectedExpression, onExpressionChange, isCustomExpression, jobExpression }: {
    selectedExpression: string; onExpressionChange: (expr: string) => void;
    isCustomExpression: boolean; jobExpression: string;
}): JSX.Element {
    return (
        <Field label="Interval">
            <Select value={selectedExpression} onChange={(e) => onExpressionChange(e.target.value)}>
                {isCustomExpression && <option value={jobExpression}>{getCronLabel(jobExpression)}</option>}
                {INTERVAL_PRESETS.map((preset) => (<option key={preset.value} value={preset.value}>{preset.label}</option>))}
            </Select>
        </Field>
    );
}

function ScheduleRevertWarning(): JSX.Element {
    return (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
            <p className="text-xs text-warning">
                Schedule changes take effect immediately but will revert to the original @Cron decorator schedule on application restart.
            </p>
        </div>
    );
}

function ScheduleActions({ onClose, onSave, isSaving, disabled }: {
    onClose: () => void; onSave: () => void; isSaving: boolean; disabled: boolean;
}): JSX.Element {
    return (
        <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={onSave} loading={isSaving} loadingLabel="Saving…" disabled={disabled}>
                Save
            </Button>
        </div>
    );
}
