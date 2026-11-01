/**
 * ROK-1926 (epic ROK-1905 W11) — pure helpers for the Forever "Ready for next
 * run" card: row order, the summary counts, the requirements line and each
 * check's chip (label, tooltip, tone). Every fail is the warning tone, never
 * danger; an unknown is neutral "?"; an n/a check has no chip (null → "—").
 */
import type { EventRaidReadiness, ReadyCheckState } from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

export type ReadySignup = EventRaidReadiness['signups'][number];
export type ReadyRequirements = EventRaidReadiness['requirements'];
type Judged = Exclude<ReadyCheckState, 'na'>;

/** Rows shown before the "N more" disclosure. */
export const READY_ROWS = 10;

/** One check's chip. */
export interface CheckCell { label: string; title: string; tone: StatusChipTone }

const MARK: Readonly<Record<Judged, { mark: string; tone: StatusChipTone }>> = {
    pass: { mark: '✓', tone: 'success' },
    fail: { mark: '✗', tone: 'warning' },
    unknown: { mark: '?', tone: 'neutral' },
};
const RANK: Readonly<Record<Judged, number>> = { fail: 0, unknown: 1, pass: 2 };
const OVERALL_WORD: Readonly<Record<Judged, string>> = { pass: 'Ready', fail: 'Not ready', unknown: 'Unknown' };

/** Not ready first, then unknown, then ready; by name within each group. */
export function sortSignups(signups: readonly ReadySignup[]): ReadySignup[] {
    return [...signups].sort((a, b) => RANK[a.overall] - RANK[b.overall] || a.name.localeCompare(b.name));
}

/** How many rows are ready / not ready / unknown. */
export function summaryCounts(signups: readonly ReadySignup[]): Record<Judged, number> {
    const counts: Record<Judged, number> = { pass: 0, fail: 0, unknown: 0 };
    for (const s of signups) counts[s.overall] += 1;
    return counts;
}

/** "Level 60+ · item level 55+ · not saved to Molten Core · quests: 3 known" — n/a parts left out. */
export function requirementsLine(r: ReadyRequirements): string {
    const parts: string[] = [];
    if (r.minLevel !== null) parts.push(`Level ${r.minLevel}+`);
    if (r.ilvlFloor !== null) parts.push(`item level ${r.ilvlFloor}+`);
    if (r.raidNames.length > 0) parts.push(`not saved to ${r.raidNames.join(', ')}`);
    if (r.questCount > 0) parts.push(`quests: ${r.questCount} known`);
    return parts.join(' · ');
}

/** "Sat 8:00 PM · in 2 days" relative to `now`. */
export function formatStart(iso: string, now: number = Date.now()): string {
    const start = new Date(iso);
    const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(start) - day(new Date(now))) / 86_400_000);
    const when = start.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return `${when} · ${new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(days, 'day')}`;
}

function chip(state: ReadyCheckState, shown: string | null, title: string): CheckCell | null {
    if (state === 'na') return null;
    const { mark, tone } = MARK[state];
    return { label: shown && state !== 'unknown' ? `${mark} ${shown}` : mark, title, tone };
}

function numberCell(s: ReadySignup, check: ReadySignup['level'], what: string, need: number | null): CheckCell | null {
    if (check.state === 'unknown' || check.value === null) return chip(check.state, null, `${s.name} — ${what} unknown`);
    const needs = check.state === 'fail' && need !== null ? `, needs ${need}` : '';
    return chip(check.state, String(check.value), `${s.name} — ${what} ${check.value}${needs}`);
}

/** Level, quests, saved and item-level chips for one row (null = n/a). */
export function rowCells(s: ReadySignup, r: ReadyRequirements): Record<'level' | 'quests' | 'saved' | 'ilvl', CheckCell | null> {
    const q = s.quests;
    const questTitle = q.state === 'unknown' ? `${s.name} — quests unknown` : `${s.name} — ${q.ready} of ${q.total} quests ready`;
    const resets = s.saved.resetAt ? new Date(s.saved.resetAt).toLocaleDateString(undefined, { weekday: 'short' }) : null;
    const savedTitle = { pass: 'not saved', fail: `saved to ${s.saved.instanceName ?? 'the raid'}${resets ? `, resets ${resets}` : ''}`, unknown: 'lockouts unknown', na: '' }[s.saved.state];
    return {
        level: numberCell(s, s.level, 'level', r.minLevel),
        quests: chip(q.state, `${q.ready}/${q.total}`, questTitle),
        saved: chip(s.saved.state, s.saved.state === 'fail' ? resets : null, `${s.name} — ${savedTitle}`),
        ilvl: numberCell(s, s.ilvl, 'item level', r.ilvlFloor),
    };
}

/** The row's overall chip; `long` adds the word ("✗ Not ready") for the phone list. */
export function overallCell(s: ReadySignup, long: boolean): CheckCell {
    const { mark, tone } = MARK[s.overall];
    const word = OVERALL_WORD[s.overall];
    return { label: long ? `${mark} ${word}` : mark, title: `${s.name} — ${word.toLowerCase()}`, tone };
}
