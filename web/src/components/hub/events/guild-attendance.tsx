/** ROK-1787 — attendance leaderboard over the last 8 weeks (prototype `proposed/AttendanceLeaderboard.tsx`). */
import type { JSX } from 'react';
import type { GuildRaidsDto, GuildAttendanceRowDto } from '@raid-ledger/contract';
import { CharacterLink } from '../../../plugins/wow/hub/character-link';
import { WidgetCard } from '../hub-bits';
import { GuildMeter } from './guild-meter';
import { percent } from './guild-raids.helpers';
import { CardFootnote, QuietEmpty } from '../../../plugins/wow/hub/raids-bits';

function LeaderRow({ row, rank }: { row: GuildAttendanceRowDto; rank: number }): JSX.Element {
    const pct = percent(row.attended, row.of);
    return (
        <li data-testid="guild-attendance-row" className="flex items-center gap-3">
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted">{rank}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm"><CharacterLink name={row.name} characterId={row.characterId} /></span>
                    <span className="shrink-0 text-xs text-secondary">
                        <span className="font-semibold text-foreground">{pct}%</span> · {row.attended}/{row.of}
                    </span>
                </div>
                <GuildMeter pct={pct} label={`${row.name} attendance`} />
            </div>
        </li>
    );
}

export function GuildAttendance({ attendance, limit }: { attendance: GuildRaidsDto['attendance']; limit?: number }): JSX.Element {
    const rows = limit === undefined ? attendance.rows : attendance.rows.slice(0, limit);
    return (
        <WidgetCard id="guild-attendance" title="Attendance leaderboard">
            {rows.length === 0
                ? <QuietEmpty>No attendance recorded yet. It fills in once a guild raid&apos;s attendance is taken.</QuietEmpty>
                : <ol className="flex flex-col gap-2.5">{rows.map((row, i) => <LeaderRow key={row.userId} row={row} rank={i + 1} />)}</ol>}
            <CardFootnote>Last {attendance.windowWeeks} weeks</CardFootnote>
        </WidgetCard>
    );
}
