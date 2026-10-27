/**
 * ROK-1969 §3.5 — pure helpers for the install sheet's setup checklist
 * (operator rulings 2026-10-26, `_approved/ROK-1969-setup-checklist/ITEM.md`):
 * per-row state labels and the card's summary chip. Unknown is always neutral;
 * only required unmet rows count toward "N steps left".
 */
import type { PluginSetupRequirement, PluginSetupStatus } from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

/** A chip's copy and tone. */
export interface SetupChipState {
    label: string;
    tone: StatusChipTone;
}

/** The whole checklist's summary: header chip, the "1 of 3 required done" line, and auto-open. */
export interface SetupSummary extends SetupChipState {
    open: boolean;
    requiredDone: number;
    requiredTotal: number;
    optional: number;
}

/** The status the api reported for one requirement, if any. */
export function statusFor(statuses: readonly PluginSetupStatus[], id: string): PluginSetupStatus | undefined {
    return statuses.find((s) => s.id === id);
}

/** One row's state chip: Done / To do / neutral unmet-optional / Manual step / Not checked. */
export function setupRowState(req: PluginSetupRequirement, status: PluginSetupStatus | undefined): SetupChipState {
    const state = status?.state ?? 'unknown';
    if (state === 'met') return { label: 'Done', tone: 'success' };
    if (state === 'unmet') return req.required ? { label: 'To do', tone: 'warning' } : { label: 'Not set up', tone: 'neutral' };
    return req.check ? { label: 'Not checked', tone: 'neutral' } : { label: 'Manual step', tone: 'neutral' };
}

/** Summarises a plugin's setup for the card header chip and the checklist header. */
export function summarizeSetup(
    requirements: readonly PluginSetupRequirement[], statuses: readonly PluginSetupStatus[],
): SetupSummary {
    const required = requirements.filter((r) => r.required);
    const stateOf = (r: PluginSetupRequirement): string => statusFor(statuses, r.id)?.state ?? 'unknown';
    const counts = {
        requiredDone: required.filter((r) => stateOf(r) === 'met').length,
        requiredTotal: required.length,
        optional: requirements.length - required.length,
    };
    if (requirements.length === 0) return { label: 'No setup needed', tone: 'success', open: false, ...counts };
    const left = required.filter((r) => stateOf(r) === 'unmet').length;
    if (left > 0) return { label: `${left} ${left === 1 ? 'step' : 'steps'} left`, tone: 'warning', open: true, ...counts };
    const unchecked = required.some((r) => r.check !== undefined && stateOf(r) === 'unknown');
    if (unchecked) return { label: 'Check setup', tone: 'neutral', open: true, ...counts };
    return { label: 'Ready', tone: 'success', open: false, ...counts };
}

/** "1 of 3 required done · 2 optional" — the checklist header's count line. */
export function setupCountLine(s: SetupSummary): string {
    const done = `${s.requiredDone} of ${s.requiredTotal} required done`;
    if (s.requiredTotal === 0) return `${s.optional} optional`;
    return s.optional > 0 ? `${done} · ${s.optional} optional` : done;
}
