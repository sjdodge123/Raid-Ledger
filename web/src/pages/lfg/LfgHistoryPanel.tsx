/**
 * ROK-1464 AC4 — "Played here before".
 *
 * Attendance wording follows the ROK-1463 DTO caveat: `attendedCount` means
 * people confirmed to have played, `signedUpCount` only means people who said
 * they would. The fallback is explicit so a row never overstates the past.
 */
import type { JSX } from 'react';
import type {
    LfgHistoryEntryDto,
    LfgHistoryResponseDto,
} from '@raid-ledger/contract';
import { LFG_COPY } from './lfg-copy';

export interface LfgHistoryPanelProps {
    history: LfgHistoryResponseDto | undefined;
    isLoading?: boolean;
}

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

/** `21 Aug` in the viewer's local time. */
function formatDay(iso: string): string {
    const date = new Date(iso);
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** `2h 40m`, `2h`, `45m`. */
export function formatDurationMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

/**
 * `3 attended` when attendance was taken, `5 signed up` when it never was,
 * and nothing at all when neither number carries information.
 */
function attendanceLabel(entry: LfgHistoryEntryDto): string | null {
    if (entry.attendedCount > 0) return `${entry.attendedCount} attended`;
    if (entry.signedUpCount > 0) return `${entry.signedUpCount} signed up`;
    return null;
}

/** One past session. */
function HistoryRow({ entry }: { entry: LfgHistoryEntryDto }): JSX.Element {
    const parts = [
        formatDay(entry.startedAt),
        attendanceLabel(entry),
        formatDurationMinutes(entry.durationMinutes),
    ].filter((part): part is string => part !== null);
    return (
        <li className="rounded-lg bg-overlay px-3 py-2">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-100">
                    {entry.title}
                </span>
                {entry.isAdHoc && (
                    <span className="rounded bg-violet-500/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Quick Play
                    </span>
                )}
            </div>
            <p className="text-xs text-muted">{parts.join(' · ')}</p>
        </li>
    );
}

/** History panel — the group's shared past on this game. */
export function LfgHistoryPanel({
    history,
    isLoading,
}: LfgHistoryPanelProps): JSX.Element {
    const entries = history?.entries ?? [];
    return (
        <section
            data-testid="lfg-history-panel"
            className="rounded-xl bg-surface p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">
                {LFG_COPY.historyTitle}
            </h2>
            {isLoading && <p className="text-sm text-muted">Loading…</p>}
            {!isLoading && entries.length === 0 && (
                <p className="text-sm text-muted">{LFG_COPY.historyEmpty}</p>
            )}
            <ul className="space-y-2">
                {entries.map((entry) => (
                    <HistoryRow key={entry.eventId} entry={entry} />
                ))}
            </ul>
        </section>
    );
}
