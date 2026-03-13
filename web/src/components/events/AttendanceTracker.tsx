import { useState } from 'react';
import { useAttendanceSummary, useRecordAttendance } from '../../hooks/use-attendance';
import { toast } from '../../lib/toast';
import type { AttendanceStatus } from '@raid-ledger/contract';

interface AttendanceTrackerProps {
    eventId: number;
    isOrganizer: boolean;
}

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; color: string }[] = [
    { value: 'attended', label: 'Attended', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    { value: 'no_show', label: 'No Show', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    { value: 'excused', label: 'Excused', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    { value: 'unmarked', label: 'Unmarked', color: 'bg-dim/20 text-muted border-dim/30' },
];

function AttendanceLoadingSkeleton() {
    return (
        <div className="rounded-lg border border-edge bg-panel/50 p-4">
            <div className="animate-pulse space-y-3">
                <div className="h-5 w-40 rounded bg-overlay" />
                <div className="h-4 w-full rounded bg-overlay" />
            </div>
        </div>
    );
}

function AttendanceSummaryBar({ summary }: { summary: { attended: number; noShow: number; excused: number; unmarked: number } }) {
    return (
        <div className="flex items-center gap-4 text-sm">
            <span className="text-emerald-400">{summary.attended} attended</span>
            <span className="text-red-400">{summary.noShow} no-show</span>
            <span className="text-amber-400">{summary.excused} excused</span>
            <span className="text-muted">{summary.unmarked} unmarked</span>
        </div>
    );
}

function AttendanceRates({ summary }: { summary: { attendanceRate: number; noShowRate: number } }) {
    return (
        <div className="flex items-center gap-4 text-xs text-muted">
            <span>Attendance rate: {Math.round(summary.attendanceRate * 100)}%</span>
            <span>No-show rate: {Math.round(summary.noShowRate * 100)}%</span>
        </div>
    );
}

function ProgressSegment({ count, total, className }: { count: number; total: number; className: string }) {
    if (count <= 0) return null;
    return <div className={`${className} h-full`} style={{ width: `${(count / total) * 100}%` }} />;
}

function AttendanceProgressBar({ summary }: { summary: { attended: number; excused: number; noShow: number; totalSignups: number } }) {
    if (summary.totalSignups <= 0) return null;
    return (
        <div className="h-2 rounded-full bg-overlay overflow-hidden flex">
            <ProgressSegment count={summary.attended} total={summary.totalSignups} className="bg-emerald-500" />
            <ProgressSegment count={summary.excused} total={summary.totalSignups} className="bg-amber-500" />
            <ProgressSegment count={summary.noShow} total={summary.totalSignups} className="bg-red-500" />
        </div>
    );
}

function StatusButton({ opt, isActive, disabled, onClick }: {
    opt: { value: AttendanceStatus; label: string; color: string }; isActive: boolean; disabled: boolean; onClick: () => void;
}) {
    return (
        <button
            key={opt.value} type="button" onClick={onClick} disabled={disabled}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                isActive ? opt.color : 'border-edge-strong text-dim hover:border-dim hover:text-muted'
            }`}
        >
            {opt.label}
        </button>
    );
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
    const opt = ATTENDANCE_OPTIONS.find((o) => o.value === status);
    return (
        <span className={`px-2 py-0.5 text-xs rounded border ${opt?.color ?? 'border-edge-strong text-dim'}`}>
            {opt?.label ?? 'Unmarked'}
        </span>
    );
}

function SignupRow({ signup, editMode, isPending, onRecord }: {
    signup: { id: number; user: { username: string }; attendanceStatus?: AttendanceStatus | null };
    editMode: boolean; isPending: boolean; onRecord: (signupId: number, status: AttendanceStatus) => void;
}) {
    const currentStatus = signup.attendanceStatus ?? 'unmarked';
    return (
        <div className="flex items-center justify-between gap-2 rounded-md border border-edge bg-panel px-3 py-2">
            <span className="text-sm text-foreground truncate">{signup.user.username}</span>
            {editMode ? (
                <div className="flex gap-1">
                    {ATTENDANCE_OPTIONS.map((opt) => (
                        <StatusButton key={opt.value} opt={opt} isActive={currentStatus === opt.value}
                            disabled={isPending} onClick={() => { if (currentStatus !== opt.value) onRecord(signup.id, opt.value); }} />
                    ))}
                </div>
            ) : (
                <StatusBadge status={currentStatus} />
            )}
        </div>
    );
}

function AttendanceHeader({ isOrganizer, editMode, onToggle }: { isOrganizer: boolean; editMode: boolean; onToggle: () => void }) {
    return (
        <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">Attendance</h3>
            {isOrganizer && (
                <button type="button" onClick={onToggle}
                    className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                    {editMode ? 'Done' : 'Edit'}
                </button>
            )}
        </div>
    );
}

export function AttendanceTracker({ eventId, isOrganizer }: AttendanceTrackerProps) {
    const { data: summary, isLoading } = useAttendanceSummary(eventId);
    const recordMutation = useRecordAttendance(eventId);
    const [editMode, setEditMode] = useState(false);

    if (isLoading || !summary) return <AttendanceLoadingSkeleton />;

    const handleRecord = (signupId: number, attendanceStatus: AttendanceStatus) => {
        recordMutation.mutate({ signupId, attendanceStatus }, {
            onError: (error) => { toast.error(error instanceof Error ? error.message : 'Failed to record attendance'); },
        });
    };

    const markedCount = summary.attended + summary.noShow + summary.excused;

    return (
        <div className="rounded-lg border border-edge bg-panel/50 p-4 space-y-4">
            <AttendanceHeader isOrganizer={isOrganizer} editMode={editMode} onToggle={() => setEditMode(!editMode)} />
            <AttendanceSummaryBar summary={summary} />
            {markedCount > 0 && <AttendanceRates summary={summary} />}
            <AttendanceProgressBar summary={summary} />
            {(editMode || markedCount > 0) && (
                <div className="space-y-2">
                    {summary.signups.map((signup) => (
                        <SignupRow key={signup.id} signup={signup} editMode={editMode}
                            isPending={recordMutation.isPending} onRecord={handleRecord} />
                    ))}
                </div>
            )}
        </div>
    );
}
