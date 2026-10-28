/**
 * ROK-1958 D-9 — one Session history row on the token rail (New pattern:
 * session timeline rail, §5). Date · "19:40–23:05 · 3 h 25 m · 14 saves"
 * ("1 save" with no range) · "Level 6 → 7" when it changed · up to three area
 * chips + "+N" (none when areas are hidden). The latest row's dot is success.
 */
import type { JSX } from 'react';
import type { Bg3Session } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import {
    formatLevelChange, formatSaveCount, formatSessionDate, formatSessionRange, sessionAreaChips,
} from '../lib/bg3-session-format';

export interface Bg3SessionRowProps {
    readonly session: Bg3Session;
    readonly latest: boolean;
    /** Injectable for tests; the viewer's zone otherwise. */
    readonly timeZone?: string;
}

function AreaChips({ areas }: { areas: Bg3Session['areas'] }): JSX.Element | null {
    const chips = sessionAreaChips(areas);
    if (chips === null || chips.labels.length === 0) return null;
    return (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="bg3-session-areas">
            {chips.labels.map((label, i) => <StatusChip key={`${label}-${i}`} tone="neutral" title={label}>{label}</StatusChip>)}
            {chips.more > 0 && <StatusChip tone="neutral" title={`${chips.more} more areas`}>+{chips.more}</StatusChip>}
        </div>
    );
}

export function Bg3SessionRow({ session, latest, timeZone }: Bg3SessionRowProps): JSX.Element {
    const range = formatSessionRange(session, timeZone);
    const count = formatSaveCount(session.saveCount);
    const level = formatLevelChange(session);
    const dot = latest ? 'bg-success' : 'bg-edge-strong';
    return (
        <li className="relative pb-2.5 pt-1.5" data-testid="bg3-session-row" data-latest={latest ? 'true' : undefined}>
            <span aria-hidden="true" className={`absolute -left-[23px] top-2.5 h-3 w-3 rounded-full border-2 border-surface ${dot}`} />
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{formatSessionDate(session.startedAt, timeZone)}</span>
                <span className="text-sm text-muted" data-testid="bg3-session-meta">{range === null ? count : `${range} · ${count}`}</span>
                {level !== null && <span className="text-xs font-semibold text-success">{level}</span>}
            </div>
            <AreaChips areas={session.areas} />
        </li>
    );
}
