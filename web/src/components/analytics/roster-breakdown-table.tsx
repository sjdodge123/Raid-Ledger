import { useState } from 'react';
import type { RosterBreakdownEntryDto } from '@raid-ledger/contract';

interface RosterBreakdownTableProps {
    roster: RosterBreakdownEntryDto[];
    hasVoiceData: boolean;
}

type SortField = 'username' | 'attendanceStatus' | 'voiceClassification' | 'voiceDurationSec';
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
    attended: 'text-emerald-400',
    no_show: 'text-red-400',
    excused: 'text-amber-400',
    unmarked: 'text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
    attended: 'Attended',
    no_show: 'No-Show',
    excused: 'Excused',
    unmarked: 'Unmarked',
};

const VOICE_LABELS: Record<string, string> = {
    full: 'Full',
    partial: 'Partial',
    late: 'Late',
    early_leaver: 'Early Leaver',
    no_show: 'No-Show',
};

const VOICE_COLORS: Record<string, string> = {
    full: 'text-emerald-400',
    partial: 'text-blue-400',
    late: 'text-amber-400',
    early_leaver: 'text-orange-400',
    no_show: 'text-red-400',
};

export function RosterBreakdownTable({
    roster,
    hasVoiceData,
}: RosterBreakdownTableProps) {
    const [sortField, setSortField] = useState<SortField>('username');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDir(field === 'username' ? 'asc' : 'desc');
        }
    };

    const sorted = [...roster].sort((a, b) => {
        const multiplier = sortDir === 'asc' ? 1 : -1;
        switch (sortField) {
            case 'username':
                return multiplier * a.username.localeCompare(b.username);
            case 'attendanceStatus':
                return (
                    multiplier *
                    (a.attendanceStatus ?? '').localeCompare(
                        b.attendanceStatus ?? '',
                    )
                );
            case 'voiceClassification':
                return (
                    multiplier *
                    (a.voiceClassification ?? '').localeCompare(
                        b.voiceClassification ?? '',
                    )
                );
            case 'voiceDurationSec':
                return (
                    multiplier *
                    ((a.voiceDurationSec ?? 0) - (b.voiceDurationSec ?? 0))
                );
            default:
                return 0;
        }
    });

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                Roster Breakdown
            </h3>

            {roster.length === 0 ? (
                <p className="text-muted text-center py-8">
                    No signups for this event.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-edge text-muted">
                                <SortableHeader
                                    field="username"
                                    label="Player"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                                <th className="text-left py-2 pr-4">
                                    Signup Status
                                </th>
                                <SortableHeader
                                    field="attendanceStatus"
                                    label="Attendance"
                                    active={sortField}
                                    dir={sortDir}
                                    onClick={handleSort}
                                />
                                {hasVoiceData && (
                                    <>
                                        <SortableHeader
                                            field="voiceClassification"
                                            label="Voice Status"
                                            active={sortField}
                                            dir={sortDir}
                                            onClick={handleSort}
                                        />
                                        <SortableHeader
                                            field="voiceDurationSec"
                                            label="Voice Duration"
                                            active={sortField}
                                            dir={sortDir}
                                            onClick={handleSort}
                                        />
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((entry, idx) => (
                                <tr
                                    key={`${entry.userId}-${idx}`}
                                    className="border-b border-edge/50 hover:bg-panel/50 transition-colors"
                                >
                                    <td className="py-2 pr-4 text-foreground">
                                        {entry.username}
                                    </td>
                                    <td className="py-2 pr-4 text-muted capitalize">
                                        {entry.signupStatus?.replace('_', ' ') ?? '--'}
                                    </td>
                                    <td
                                        className={`py-2 pr-4 font-medium ${
                                            STATUS_COLORS[
                                                entry.attendanceStatus ?? 'unmarked'
                                            ] ?? 'text-gray-500'
                                        }`}
                                    >
                                        {STATUS_LABELS[
                                            entry.attendanceStatus ?? 'unmarked'
                                        ] ?? 'Unmarked'}
                                    </td>
                                    {hasVoiceData && (
                                        <>
                                            <td
                                                className={`py-2 pr-4 ${
                                                    entry.voiceClassification
                                                        ? (VOICE_COLORS[
                                                              entry.voiceClassification
                                                          ] ?? 'text-muted')
                                                        : 'text-muted'
                                                }`}
                                            >
                                                {entry.voiceClassification
                                                    ? (VOICE_LABELS[
                                                          entry.voiceClassification
                                                      ] ??
                                                      entry.voiceClassification)
                                                    : '--'}
                                            </td>
                                            <td className="py-2 pr-4 text-muted">
                                                {entry.voiceDurationSec != null
                                                    ? formatDuration(
                                                          entry.voiceDurationSec,
                                                      )
                                                    : '--'}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SortableHeader({
    field,
    label,
    active,
    dir,
    onClick,
}: {
    field: SortField;
    label: string;
    active: SortField;
    dir: SortDir;
    onClick: (field: SortField) => void;
}) {
    const isActive = active === field;
    return (
        <th
            className="text-left py-2 pr-4 cursor-pointer hover:text-foreground select-none"
            onClick={() => onClick(field)}
        >
            {label}
            {isActive && (
                <span className="ml-1">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
            )}
        </th>
    );
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
