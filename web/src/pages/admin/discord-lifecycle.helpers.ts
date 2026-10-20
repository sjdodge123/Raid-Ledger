/**
 * ROK-1428 (L7) — pure helpers for the channel-lifecycle admin page.
 */
import { formatDistanceToNow } from 'date-fns';
import type { GameActivitySignalKind, GameLifecycleActivityDto, LifecycleAction, ReconcileResultDto } from '@raid-ledger/contract';
import type { StatusChipTone } from '../../components/ui/status-chip';

const SIGNAL_LABELS: Record<GameActivitySignalKind, string> = {
    event: 'Events', poll: 'Polls', event_plan: 'Plans', lineup_vote: 'Lineup votes', hub: 'Hub',
};

/** Chip text for one signal, e.g. "Events 2". */
export function signalLabel(kind: GameActivitySignalKind, itemCount: number): string {
    return `${SIGNAL_LABELS[kind]} ${itemCount}`;
}

const ACTION_CHIPS: Record<LifecycleAction, { tone: StatusChipTone; label: string }> = {
    create: { tone: 'success', label: 'Create' },
    unarchive: { tone: 'success', label: 'Unarchive' },
    archive: { tone: 'warning', label: 'Archive' },
    link_hub: { tone: 'neutral', label: 'Link hub' },
    none: { tone: 'neutral', label: 'No change' },
};

/** The Next-action chip; a suppressed game shows "Suppressed" whatever was planned. */
export function actionChip(row: GameLifecycleActivityDto): { tone: StatusChipTone; label: string } {
    if (row.suppressed) return { tone: 'neutral', label: 'Suppressed' };
    return ACTION_CHIPS[row.action];
}

export type BindingStateLabel = 'active' | 'archived' | 'manual';

/** `manual` for a hand-made binding; otherwise the lifecycle state. */
export function bindingState(binding: GameLifecycleActivityDto['binding']): BindingStateLabel | null {
    if (!binding) return null;
    return binding.autoManaged ? binding.lifecycleState : 'manual';
}

/** A whole number inside [min, max], or an error string. */
export function parseBounded(raw: string, min: number, max: number): { value: number } | { error: string } {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
        return { error: `Enter a whole number from ${min} to ${max}.` };
    }
    return { value: n };
}

/** "3 hours ago", or "—" with no timestamp. */
export function relativeTime(iso: string | null): string {
    return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : '—';
}

/** The confirm prompt: "Create 2, archive 1, unarchive 0 channels in Discord?" */
export function confirmCopy(r: ReconcileResultDto): string {
    return `Create ${r.created}, archive ${r.archived}, unarchive ${r.unarchived} channels in Discord?`;
}

/** One-line result summary. */
export function resultSummary(r: ReconcileResultDto): string {
    const head = r.dryRun ? 'Would change — ' : '';
    return `${head}Created ${r.created} · Unarchived ${r.unarchived} · Archived ${r.archived} · Hubs linked ${r.linkedHubs} · Failed ${r.failed} · Deferred ${r.deferred}`;
}

const STOP_COPY: Record<NonNullable<ReconcileResultDto['stoppedReason']>, string> = {
    permissions: 'Stopped: the bot is missing Manage Channels or access in Discord.',
    disabled: 'Stopped: channel automation is off.',
    offline: 'Stopped: the Discord bot is offline.',
    'no-archive-category': 'Stopped: no Archived category could be found or created.',
};

/** Banner copy for a stopped run. */
export function stopCopy(reason: ReconcileResultDto['stoppedReason']): string | null {
    return reason ? STOP_COPY[reason] : null;
}
