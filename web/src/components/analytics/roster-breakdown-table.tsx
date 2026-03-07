import { useState } from 'react';
import type { RosterBreakdownEntryDto } from '@raid-ledger/contract';
import { formatDuration } from '../../lib/format-duration';

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

function sortRoster(roster: RosterBreakdownEntryDto[], sortField: SortField, sortDir: SortDir) {
    const m = sortDir === 'asc' ? 1 : -1;
    return [...roster].sort((a, b) => {
        switch (sortField) {
            case 'username': return m * a.username.localeCompare(b.username);
            case 'attendanceStatus': return m * (a.attendanceStatus ?? '').localeCompare(b.attendanceStatus ?? '');
            case 'voiceClassification': return m * (a.voiceClassification ?? '').localeCompare(b.voiceClassification ?? '');
            case 'voiceDurationSec': return m * ((a.voiceDurationSec ?? 0) - (b.voiceDurationSec ?? 0));
            default: return 0;
        }
    });
}

function RosterRow({ entry, hasVoiceData }: { entry: RosterBreakdownEntryDto; hasVoiceData: boolean }) {
    return (
        <tr className="border-b border-edge/50 hover:bg-panel/50 transition-colors">
            <td className="py-2 pr-4 text-foreground">{entry.username}</td>
            <td className="py-2 pr-4 text-muted capitalize">{entry.signupStatus?.replace('_', ' ') ?? '--'}</td>
            <td className={`py-2 pr-4 font-medium ${STATUS_COLORS[entry.attendanceStatus ?? 'unmarked'] ?? 'text-gray-500'}`}>
                {STATUS_LABELS[entry.attendanceStatus ?? 'unmarked'] ?? 'Unmarked'}
            </td>
            {hasVoiceData && (
                <>
                    <td className={`py-2 pr-4 ${entry.voiceClassification ? (VOICE_COLORS[entry.voiceClassification] ?? 'text-muted') : 'text-muted'}`}>
                        {entry.voiceClassification ? (VOICE_LABELS[entry.voiceClassification] ?? entry.voiceClassification) : '--'}
                    </td>
                    <td className="py-2 pr-4 text-muted">{entry.voiceDurationSec != null ? formatDuration(entry.voiceDurationSec) : '--'}</td>
                </>
            )}
        </tr>
    );
}

function RosterTableHeaders({ sortField, sortDir, handleSort, hasVoiceData }: { sortField: SortField; sortDir: SortDir; handleSort: (f: SortField) => void; hasVoiceData: boolean }) {
    return (
        <tr className="border-b border-edge text-muted">
            <SortableHeader field="username" label="Player" active={sortField} dir={sortDir} onClick={handleSort} />
            <th className="text-left py-2 pr-4">Signup Status</th>
            <SortableHeader field="attendanceStatus" label="Attendance" active={sortField} dir={sortDir} onClick={handleSort} />
            {hasVoiceData && (
                <>
                    <SortableHeader field="voiceClassification" label="Voice Status" active={sortField} dir={sortDir} onClick={handleSort} />
                    <SortableHeader field="voiceDurationSec" label="Voice Duration" active={sortField} dir={sortDir} onClick={handleSort} />
                </>
            )}
        </tr>
    );
}

export function RosterBreakdownTable({ roster, hasVoiceData }: RosterBreakdownTableProps) {
    const [sortField, setSortField] = useState<SortField>('username');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const handleSort = (field: SortField) => {
        if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortField(field); setSortDir(field === 'username' ? 'asc' : 'desc'); }
    };

    const sorted = sortRoster(roster, sortField, sortDir);

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Roster Breakdown</h3>
            {roster.length === 0 ? (
                <p className="text-muted text-center py-8">No signups for this event.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead><RosterTableHeaders sortField={sortField} sortDir={sortDir} handleSort={handleSort} hasVoiceData={hasVoiceData} /></thead>
                        <tbody>{sorted.map((entry, idx) => (<RosterRow key={`${entry.userId}-${idx}`} entry={entry} hasVoiceData={hasVoiceData} />))}</tbody>
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
