/** Pure view helpers for the Pelican admin Servers section (ROK-1094). */
import type { PelicanServerRowDto, PelicanServerUpdate, PelicanSyncResult } from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

export type ChipTone = StatusChipTone;

export interface StateChipView { tone: ChipTone; label: string; title: string }

/**
 * Member state → chip. A fresh suspended server reports `offline`, where `isSuspended`
 * wins (ruling Q8); a stale row (`unknown`) stays Unknown, as members see it.
 */
export function stateChipView(row: Pick<PelicanServerRowDto, 'state' | 'isSuspended'>): StateChipView {
    if (row.isSuspended && row.state === 'offline') return { tone: 'danger', label: 'Suspended', title: 'Suspended on the panel — members see it as offline' };
    switch (row.state) {
        case 'running': return { tone: 'success', label: 'Running', title: 'The server is running' };
        case 'starting': return { tone: 'warning', label: 'Starting', title: 'The server is starting' };
        case 'stopping': return { tone: 'warning', label: 'Stopping', title: 'The server is stopping' };
        case 'offline': return { tone: 'danger', label: 'Offline', title: 'The server is offline' };
        default: return { tone: 'neutral', label: 'Unknown', title: 'Not checked recently' };
    }
}

export type SyncToastTone = 'success' | 'info' | 'error';

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One toast per Sync-now outcome (§4.8): ok = success, in_progress = info, everything else = error. */
export function syncToast(result: PelicanSyncResult): { tone: SyncToastTone; text: string } {
    if (result.code === 'ok') {
        const extra = [
            result.markedMissing > 0 ? `${result.markedMissing} missing from panel` : '',
            result.restored > 0 ? `${result.restored} back` : '',
        ].filter(Boolean).join(', ');
        return { tone: 'success', text: `Synced ${plural(result.upserted, 'server')}${extra ? ` (${extra})` : ''}` };
    }
    const text = result.message || `Sync failed (${result.code})`;
    return { tone: result.code === 'in_progress' ? 'info' : 'error', text };
}

/** The row as it will look once `patch` lands — the optimistic cache write. */
export function applyServerPatch(
    row: PelicanServerRowDto, patch: PelicanServerUpdate, gameName?: string | null,
): PelicanServerRowDto {
    return {
        ...row,
        ...(patch.showOnCalendar === undefined ? {} : { showOnCalendar: patch.showOnCalendar }),
        ...(patch.presenceTracking === undefined ? {} : { presenceTracking: patch.presenceTracking }),
        ...(patch.gameId === undefined ? {} : {
            gameId: patch.gameId,
            gameName: patch.gameId === null ? null : gameName ?? row.gameName,
        }),
    };
}

/** Undo a failed `patch` on `row` from `prev` — only the fields it touched, so other saved edits survive. */
export function restoreServerFields(
    row: PelicanServerRowDto, prev: PelicanServerRowDto, patch: PelicanServerUpdate,
): PelicanServerRowDto {
    return {
        ...row,
        ...(patch.showOnCalendar === undefined ? {} : { showOnCalendar: prev.showOnCalendar }),
        ...(patch.presenceTracking === undefined ? {} : { presenceTracking: prev.presenceTracking }),
        ...(patch.gameId === undefined ? {} : { gameId: prev.gameId, gameName: prev.gameName }),
    };
}

/**
 * Why "Detect Quick Play from server logs" can't be turned on (ROK-1800), or null when
 * it can: the server needs a mapped game, and that game needs a log parser (Valheim today).
 */
export function quickPlayHint(row: Pick<PelicanServerRowDto, 'gameId' | 'presenceSupported'>): string | null {
    if (row.gameId === null) return 'Map a game first';
    if (!row.presenceSupported) return 'Not available for this game yet';
    return null;
}

export function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
}
