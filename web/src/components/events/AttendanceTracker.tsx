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
    { value: 'unmarked', label: 'Unmarked', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
];

export function AttendanceTracker({ eventId, isOrganizer }: AttendanceTrackerProps) {
    const { data: summary, isLoading } = useAttendanceSummary(eventId);
    const recordMutation = useRecordAttendance(eventId);
    const [editMode, setEditMode] = useState(false);

    if (isLoading || !summary) {
        return (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="animate-pulse space-y-3">
                    <div className="h-5 w-40 rounded bg-zinc-700" />
                    <div className="h-4 w-full rounded bg-zinc-700" />
                </div>
            </div>
        );
    }

    const handleRecord = (signupId: number, attendanceStatus: AttendanceStatus) => {
        recordMutation.mutate(
            { signupId, attendanceStatus },
            {
                onError: (error) => {
                    toast.error(error instanceof Error ? error.message : 'Failed to record attendance');
                },
            },
        );
    };

    const markedCount = summary.attended + summary.noShow + summary.excused;

    return (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-zinc-100">Attendance</h3>
                {isOrganizer && (
                    <button
                        type="button"
                        onClick={() => setEditMode(!editMode)}
                        className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                        {editMode ? 'Done' : 'Edit'}
                    </button>
                )}
            </div>

            {/* Summary bar */}
            <div className="flex items-center gap-4 text-sm">
                <span className="text-emerald-400">{summary.attended} attended</span>
                <span className="text-red-400">{summary.noShow} no-show</span>
                <span className="text-amber-400">{summary.excused} excused</span>
                <span className="text-zinc-400">{summary.unmarked} unmarked</span>
            </div>

            {markedCount > 0 && (
                <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span>Attendance rate: {Math.round(summary.attendanceRate * 100)}%</span>
                    <span>No-show rate: {Math.round(summary.noShowRate * 100)}%</span>
                </div>
            )}

            {/* Progress bar */}
            {summary.totalSignups > 0 && (
                <div className="h-2 rounded-full bg-zinc-700 overflow-hidden flex">
                    {summary.attended > 0 && (
                        <div
                            className="bg-emerald-500 h-full"
                            style={{ width: `${(summary.attended / summary.totalSignups) * 100}%` }}
                        />
                    )}
                    {summary.excused > 0 && (
                        <div
                            className="bg-amber-500 h-full"
                            style={{ width: `${(summary.excused / summary.totalSignups) * 100}%` }}
                        />
                    )}
                    {summary.noShow > 0 && (
                        <div
                            className="bg-red-500 h-full"
                            style={{ width: `${(summary.noShow / summary.totalSignups) * 100}%` }}
                        />
                    )}
                </div>
            )}

            {/* Per-signup attendance list */}
            {(editMode || markedCount > 0) && (
                <div className="space-y-2">
                    {summary.signups.map((signup) => {
                        const currentStatus = signup.attendanceStatus ?? 'unmarked';
                        return (
                            <div
                                key={signup.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2"
                            >
                                <span className="text-sm text-zinc-200 truncate">
                                    {signup.user.username}
                                </span>
                                {editMode ? (
                                    <div className="flex gap-1">
                                        {ATTENDANCE_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => {
                                                    if (currentStatus !== opt.value) {
                                                        handleRecord(signup.id, opt.value);
                                                    }
                                                }}
                                                disabled={recordMutation.isPending}
                                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                                    currentStatus === opt.value
                                                        ? opt.color
                                                        : 'border-zinc-600 text-zinc-500 hover:border-zinc-500 hover:text-zinc-400'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <span
                                        className={`px-2 py-0.5 text-xs rounded border ${
                                            ATTENDANCE_OPTIONS.find((o) => o.value === currentStatus)
                                                ?.color ?? 'border-zinc-600 text-zinc-500'
                                        }`}
                                    >
                                        {ATTENDANCE_OPTIONS.find((o) => o.value === currentStatus)
                                            ?.label ?? 'Unmarked'}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
