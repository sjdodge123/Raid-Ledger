export type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';

/** Measured grid dimensions used by overlay positioning */
export interface GridDims {
    colWidth: number;
    rowHeight: number;
    headerHeight: number;
    colStartLeft: number;
}

/** Preview block for showing where a specific event falls on the grid */
export interface GameTimePreviewBlock {
    dayOfWeek: number; // 0=Sun, 6=Sat
    startHour: number;
    endHour: number;
    label?: string;
    /** 'current' = dashed cyan (default), 'selected' = solid cyan (ROK-223, ROK-475) */
    variant?: 'current' | 'selected';
    // Rich fields (optional, for calendar-parity rendering inside the block)
    title?: string;
    gameName?: string;
    gameSlug?: string;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string | null;
    /** Game ID threaded through so RichEventBlock can resolve character avatars (ROK-1133) */
    gameId?: number | null;
    attendees?: Array<{
        id: number;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        discordId?: string | null;
        characters?: Array<{ gameId: number | string; name?: string; avatarUrl: string | null }>;
    }>;
    attendeeCount?: number;
}

/** Single cell in a heatmap overlay (ROK-223) */
export interface HeatmapCell {
    dayOfWeek: number;
    hour: number;
    availableCount: number;
    totalCount: number;
    /** Members whose game time is stale (ROK-1560) — hatched, never counted as available */
    staleCount?: number;
    /** Members with no game-time template at all (ROK-1560) — hatched */
    unknownCount?: number;
    /**
     * Members whose template covers this cell but who are signed up for an event
     * / away at that hour (ROK-1584) — already subtracted from `availableCount`.
     */
    busyCount?: number;
}

/**
 * Per-cell heatmap lookup value (ROK-1560). `stale` / `unknown` are absent for
 * aggregates without the freshness model (the events heatmap), which must render
 * exactly as it did before.
 */
export interface HeatmapCellData {
    available: number;
    total: number;
    stale?: number;
    unknown?: number;
    /** ROK-1584: templated members committed elsewhere at this hour. */
    busy?: number;
}

export interface GameTimeGridProps {
    slots: import('@raid-ledger/contract').GameTimeSlot[];
    onChange?: (slots: import('@raid-ledger/contract').GameTimeSlot[]) => void;
    readOnly?: boolean;
    className?: string;
    tzLabel?: string;
    events?: import('@raid-ledger/contract').GameTimeEventBlock[];
    onEventClick?: (event: import('@raid-ledger/contract').GameTimeEventBlock, anchorRect: DOMRect) => void;
    previewBlocks?: GameTimePreviewBlock[];
    /** Day index for today (0=Sun, 6=Sat) — highlights the column green */
    todayIndex?: number;
    /** Fractional current hour (e.g., 15.5 = 3:30 PM) — red time indicator line */
    currentHour?: number;
    /** Visible hour range (default [0, 24]) — use [6, 24] in modals */
    hourRange?: [number, number];
    /** Events for the next week (shown in "past" cells for rolling view) */
    nextWeekEvents?: import('@raid-ledger/contract').GameTimeEventBlock[];
    /** Slots for the next week (shown in "past" cells for rolling view) */
    nextWeekSlots?: import('@raid-ledger/contract').GameTimeSlot[];
    /** ISO date string for the start of the displayed week (e.g., "2026-02-08") */
    weekStart?: string;
    /** Heatmap overlay data: intensity cells for aggregate availability (ROK-223) */
    heatmapOverlay?: HeatmapCell[];
    /** Callback when a cell is clicked (ROK-223, used in reschedule modal) */
    onCellClick?: (dayOfWeek: number, hour: number) => void;
    /** Use full day names ("Sunday" instead of "Sun") — used for weekly template view */
    fullDayNames?: boolean;
    /** Compact mode — shorter cell height for space-constrained layouts (e.g. onboarding wizard) */
    compact?: boolean;
    /** Disable the top-16 sticky offset on day headers (use top-0). For use inside modals. */
    noStickyOffset?: boolean;
}
