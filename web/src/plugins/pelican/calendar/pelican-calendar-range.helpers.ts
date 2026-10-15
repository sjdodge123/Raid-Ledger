/**
 * ROK-1775 (Codex P1) — `GET /game-servers/calendar` rejects a range wider than
 * `GAME_SERVER_CALENDAR_MAX_RANGE_DAYS`, but the Schedule view asks for three
 * months. The fetcher splits the range into contiguous chunks within the cap
 * and merges the answers. Windows are not clipped server-side (D7), so a window
 * spanning a chunk boundary comes back from both chunks — dedupe by content.
 */
import { GAME_SERVER_CALENDAR_MAX_RANGE_DAYS, type GameServerCalendarItemDto } from '@raid-ledger/contract';
import type { CalendarLayerRange } from '../../calendar-layer';

const DAY_MS = 86_400_000;

/** `[from, to]` → contiguous sub-ranges, each spanning at most `maxDays`. */
export function splitCalendarRange(
    range: CalendarLayerRange,
    maxDays: number = GAME_SERVER_CALENDAR_MAX_RANGE_DAYS,
): CalendarLayerRange[] {
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    const step = maxDays * DAY_MS;
    if (!(to - from > step)) return [range];
    const out: CalendarLayerRange[] = [];
    for (let start = from; start < to; start += step) {
        const end = Math.min(start + step, to);
        out.push({ from: new Date(start).toISOString(), to: end === to ? range.to : new Date(end).toISOString() });
    }
    return out;
}

/** Concatenate chunk answers, keeping the first copy of each identical item. */
export function mergeCalendarItems(chunks: readonly GameServerCalendarItemDto[][]): GameServerCalendarItemDto[] {
    const seen = new Set<string>();
    const out: GameServerCalendarItemDto[] = [];
    for (const item of chunks.flat()) {
        const key = JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
