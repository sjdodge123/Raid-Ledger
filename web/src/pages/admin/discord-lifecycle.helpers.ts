/**
 * ROK-1428 (L7) — pure helpers for the channel-lifecycle admin page.
 */
import { formatDistanceToNow } from 'date-fns';
import type {
    GameActivitySignalKind, GameLifecycleActivityDto, LifecycleAction, ReconcileResultDto, UpdateChannelLifecycleSettingsDto,
} from '@raid-ledger/contract';
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

/** The Next-action label alone (run result rows). */
export function actionLabel(action: LifecycleAction): string {
    return ACTION_CHIPS[action].label;
}

type ReconcileOutcome = ReconcileResultDto['items'][number]['outcome'];
const OUTCOME_LABELS: Record<ReconcileOutcome, string> = { done: 'done', planned: 'planned', failed: 'failed', deferred: 'deferred to the next run' };

/** Human copy for one run row's outcome. */
export function outcomeLabel(outcome: ReconcileOutcome): string {
    return OUTCOME_LABELS[outcome];
}

export type BindingStateLabel = 'Active' | 'Archived' | 'Manual';

/** `Manual` for a hand-made binding; otherwise the title-cased lifecycle state. */
export function bindingState(binding: GameLifecycleActivityDto['binding']): BindingStateLabel | null {
    if (!binding) return null;
    if (!binding.autoManaged) return 'Manual';
    return binding.lifecycleState === 'archived' ? 'Archived' : 'Active';
}

/** How far a query has got — drives the §4.5 loading / error / empty states. */
export type LoadState = 'loading' | 'error' | 'ready';

/** Map a TanStack query's flags onto a `LoadState`. */
export function loadState(q: { isPending: boolean; isError: boolean }): LoadState {
    if (q.isError) return 'error';
    return q.isPending ? 'loading' : 'ready';
}

type SettingsKey = keyof UpdateChannelLifecycleSettingsDto;

/** Which settings keys each section saves — routes a PATCH error to its own section. */
export const SECTION_KEYS: Record<'automation' | 'categories' | 'thresholds', readonly SettingsKey[]> = {
    automation: ['enabled'],
    categories: ['gamesCategoryId', 'archiveCategoryId', 'hideOnArchive'],
    thresholds: ['recentActivityDays', 'createThreshold', 'maxChangesPerTick'],
};

/** The PATCH error message when the failed patch touched one of `keys`. */
export function sectionError(
    error: Error | null, patch: UpdateChannelLifecycleSettingsDto | undefined, keys: readonly SettingsKey[],
): string | undefined {
    if (!error || !patch) return undefined;
    const touched = keys.some((k) => k in patch);
    return touched ? error.message : undefined;
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

/** The confirm prompt: "Create 2, archive 1, unarchive 0 channels [and link 1 hubs] in Discord?" */
export function confirmCopy(r: ReconcileResultDto): string {
    const hubs = r.linkedHubs > 0 ? ` and link ${r.linkedHubs} hubs` : '';
    return `Create ${r.created}, archive ${r.archived}, unarchive ${r.unarchived} channels${hubs} in Discord?`;
}

/** Channels a run would create, archive or unarchive. */
export function plannedChanges(r: ReconcileResultDto): number {
    return r.created + r.archived + r.unarchived;
}

/** Ask to confirm only a dry run that can go ahead and would change something (hub links included). */
export function needsConfirm(r: ReconcileResultDto): boolean {
    return !r.stoppedReason && (plannedChanges(r) > 0 || r.linkedHubs > 0);
}

/** One-line result summary: future tense for a dry run, past for a real one. */
export function resultSummary(r: ReconcileResultDto): string {
    if (r.dryRun) {
        if (!r.stoppedReason && plannedChanges(r) === 0 && r.linkedHubs === 0) return 'Nothing to change — every game channel is up to date.';
        return `Would create ${r.created} · unarchive ${r.unarchived} · archive ${r.archived} · link ${r.linkedHubs} hubs · defer ${r.deferred}`;
    }
    return `Created ${r.created} · Unarchived ${r.unarchived} · Archived ${r.archived} · Hubs linked ${r.linkedHubs} · Failed ${r.failed} · Deferred ${r.deferred}`;
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
