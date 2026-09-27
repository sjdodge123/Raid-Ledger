import type { JSX } from 'react';
import { useState } from 'react';
import type { CronJobDto, CronJobExecutionDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
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

/** Execution history modal for a cron job — the shared Modal (tech-debt [28]). */
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
        <Modal isOpen onClose={onClose} title="Execution History" maxWidth="max-w-2xl">
            <p className="text-sm text-muted mb-3">{job.description || job.name}</p>
            <ExecutionHistoryBody executions={executions} isLoading={isLoading} tz={tz} />
        </Modal>
    );
}

function ExecutionHistoryBody({ executions, isLoading, tz }: {
    executions: CronJobExecutionDto[] | undefined; isLoading: boolean; tz: string;
}): JSX.Element {
    return (
        <div className="overflow-x-auto">
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

    const saveDisabled = selectedExpression === job.cronExpression || selectedExpression === normalizedExpression;
    return (
        <Modal isOpen onClose={onClose} title={`Edit Schedule: ${formatJobName(job.name)}`}
            footer={<ScheduleActions onClose={onClose} onSave={handleSave} isSaving={updateSchedule.isPending} disabled={saveDisabled} />}>
            <EditScheduleBody job={job} tz={tz} selectedExpression={selectedExpression}
                isCustomExpression={isCustomExpression} onExpressionChange={setSelectedExpression} />
        </Modal>
    );
}

/** Body for the edit schedule modal; its Cancel/Save sit in the Modal footer. */
function EditScheduleBody({
    job, tz, selectedExpression, isCustomExpression, onExpressionChange,
}: {
    job: CronJobDto; tz: string; selectedExpression: string; isCustomExpression: boolean;
    onExpressionChange: (expr: string) => void;
}): JSX.Element {
    return (
        <div className="space-y-4">
            {job.description && <p className="text-sm text-muted">{job.description}</p>}
            <RunTimesGrid job={job} tz={tz} />
            <IntervalSelector selectedExpression={selectedExpression} onExpressionChange={onExpressionChange}
                isCustomExpression={isCustomExpression} jobExpression={job.cronExpression} />
            <ScheduleRevertWarning />
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
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={onSave} loading={isSaving} loadingLabel="Saving…" disabled={disabled}>
                Save
            </Button>
        </>
    );
}
