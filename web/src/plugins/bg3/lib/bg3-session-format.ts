/**
 * ROK-1958 D-9 — Session history row formatting. Times render in the viewer's
 * time zone (`timeZone` is injectable for tests). Area ids map through the
 * contract's `bg3LevelDisplay` (raw-id fallback).
 */
import { bg3LevelDisplay, type Bg3Session } from '@raid-ledger/contract';

export const BG3_SESSION_AREA_CHIPS = 3;

/** "Tue 27 Oct". */
export function formatSessionDate(iso: string, timeZone?: string): string {
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso)).replace(',', '');
}

function clock(iso: string, timeZone?: string): string {
    return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
}

/** "3 h 25 m", "45 m", "2 h". */
export function formatSessionDuration(ms: number): string {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} m`;
    return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** "19:40–23:05 · 3 h 25 m"; null for a one-save session (no range to show). */
export function formatSessionRange(s: Bg3Session, timeZone?: string): string | null {
    if (s.saveCount <= 1) return null;
    const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
    return `${clock(s.startedAt, timeZone)}–${clock(s.endedAt, timeZone)} · ${formatSessionDuration(ms)}`;
}

/** "1 save" / "14 saves". */
export function formatSaveCount(n: number): string {
    return n === 1 ? '1 save' : `${n} saves`;
}

/** "Level 6 → 7" only when the party level changed. */
export function formatLevelChange(s: Bg3Session): string | null {
    return s.partyLevelFrom === s.partyLevelTo ? null : `Level ${s.partyLevelFrom} → ${s.partyLevelTo}`;
}

export interface Bg3AreaChips {
    readonly labels: readonly string[];
    /** How many areas beyond the cap ("+N"); 0 = no overflow chip. */
    readonly more: number;
}

/** Up to three area labels + the overflow count; null when areas are hidden. */
export function sessionAreaChips(areas: readonly string[] | null, max = BG3_SESSION_AREA_CHIPS): Bg3AreaChips | null {
    if (areas === null) return null;
    return {
        labels: areas.slice(0, max).map((id) => bg3LevelDisplay(id).label),
        more: Math.max(0, areas.length - max),
    };
}
