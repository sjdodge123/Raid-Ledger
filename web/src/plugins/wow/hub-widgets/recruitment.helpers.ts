/**
 * ROK-1789 — pure helpers for the guild Recruitment card and its editor's
 * draft. The headline state comes from the server view
 * (`recruitmentHeadline` in the contract), never re-derived on the web.
 */
import {
    GuildRecruitmentSchema,
    WOW_CLASSIC_RECRUIT_CLASSES,
    WOW_RECRUIT_CLASSES,
    recruitmentHeadline,
    type CharacterRole,
    type GuildRecruitmentState,
    type GuildRecruitmentView,
    type GuildRecruitWanted,
    type PutGuildRecruitmentInput,
    type WowRecruitClass,
} from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';
import { syncedAgo } from '../../../lib/synced-ago';
import { isWowForeverSlug } from '../lib/forever-identity';

interface StateMeta { tone: StatusChipTone; label: string; explainer: string }

/** Chip tone + label (headline and per row) and the headline's one-line explainer. */
export const RECRUIT_STATE_META: Record<GuildRecruitmentState, StateMeta> = {
    open: { tone: 'success', label: 'Open', explainer: 'Actively recruiting' },
    limited: { tone: 'warning', label: 'Limited', explainer: 'Exceptional applicants only' },
    closed: { tone: 'neutral', label: 'Closed', explainer: 'Not recruiting right now.' },
};

const STATE_RANK: Record<GuildRecruitmentState, number> = { open: 0, limited: 1, closed: 2 };

/** Rows open → limited → closed; editor order kept within a state (A-D10). */
export function sortWanted(wanted: readonly GuildRecruitWanted[]): GuildRecruitWanted[] {
    return [...wanted].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
}

/** The class picker's options (A-D7): the 9 Classic classes on a Forever / Classic hub, all 13 on Retail. */
export function recruitClassesFor(gameSlug: string | null | undefined): readonly WowRecruitClass[] {
    const classic = isWowForeverSlug(gameSlug) || (gameSlug ?? '').includes('classic');
    return classic ? WOW_CLASSIC_RECRUIT_CLASSES : WOW_RECRUIT_CLASSES;
}

/** "Updated 3 days ago by Thalia" — the guild-text wording; a deleted editor reads "a former member". */
export function recruitmentUpdatedLine(updatedAt: string, updatedBy: string | null, now: number = Date.now()): string {
    return `Updated ${syncedAgo(updatedAt, now)} by ${updatedBy ?? 'a former member'}`;
}

/** Role labels for the editor's role picker and its duplicate-row error. */
export const RECRUIT_ROLE_LABEL: Record<CharacterRole, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };
export const RECRUIT_ROLES: readonly CharacterRole[] = ['tank', 'healer', 'dps'];
export const APPLY_URL_ERROR = 'Use a full http(s) link';

/** One editable wanted row: the stored entry, a stable React key and a plain-string note. */
export interface DraftWanted { key: number; className: WowRecruitClass; role: CharacterRole; state: GuildRecruitmentState; note: string }
/** The editor's working copy; `applyUrl` is the raw input text ('' = no link). */
export interface RecruitmentDraft { recruiting: boolean; wanted: DraftWanted[]; applyUrl: string }

let draftKey = 0;
const toDraftRow = (w: GuildRecruitWanted): DraftWanted =>
    ({ key: ++draftKey, className: w.className, role: w.role, state: w.state, note: w.note ?? '' });

/** The draft a view opens with; unset → recruiting, no rows, no link. */
export function draftOf(view: GuildRecruitmentView): RecruitmentDraft {
    const r = view.recruitment;
    if (r === null) return { recruiting: true, wanted: [], applyUrl: '' };
    return { recruiting: r.recruiting, wanted: r.wanted.map(toDraftRow), applyUrl: r.applyUrl ?? '' };
}

/** The PUT body: notes trimmed (blank ones dropped), a blank link sent as null. */
export function toPutBody(draft: RecruitmentDraft): PutGuildRecruitmentInput {
    const url = draft.applyUrl.trim();
    const wanted = draft.wanted.map(({ className, role, state, note }): GuildRecruitWanted => {
        const text = note.trim();
        return text === '' ? { className, role, state } : { className, role, state, note: text };
    });
    return { recruiting: draft.recruiting, wanted, applyUrl: url === '' ? null : url };
}

/** True when saving would change what the view holds. */
export function isDirty(draft: RecruitmentDraft, view: GuildRecruitmentView): boolean {
    return JSON.stringify(toPutBody(draft)) !== JSON.stringify(toPutBody(draftOf(view)));
}

/** The headline the card would show after saving this draft (contract derivation, A-D3). */
export function draftHeadline(draft: RecruitmentDraft): GuildRecruitmentState {
    return recruitmentHeadline(toPutBody(draft));
}

/** Switch on, at least one row, and every row Closed → the card reads Closed anyway. */
export function isAllClosed(draft: RecruitmentDraft): boolean {
    return draft.recruiting && draft.wanted.length > 0 && draft.wanted.every((w) => w.state === 'closed');
}

/** Inline errors: the link, each repeated class + role row (by key), and any other schema failure. */
export interface DraftErrors { applyUrl: string | null; rows: ReadonlyMap<number, string>; other: string | null }

function duplicateRows(rows: readonly DraftWanted[]): Map<number, string> {
    const seen = new Set<string>();
    const out = new Map<number, string>();
    for (const r of rows) {
        const pair = `${r.className}|${r.role}`;
        if (seen.has(pair)) out.set(r.key, `${r.className} ${RECRUIT_ROLE_LABEL[r.role]} is already listed.`);
        seen.add(pair);
    }
    return out;
}

/** Validates the draft with the contract schema (AC6); a duplicate pair is reported on the repeat row. */
export function draftErrors(draft: RecruitmentDraft): DraftErrors {
    const rows = duplicateRows(draft.wanted);
    const parsed = GuildRecruitmentSchema.safeParse(toPutBody(draft));
    if (parsed.success) return { applyUrl: null, rows, other: null };
    const issues = parsed.error.issues;
    const urlBad = issues.some((i) => i.path[0] === 'applyUrl');
    const other = rows.size > 0 ? undefined : issues.find((i) => i.path[0] !== 'applyUrl');
    return { applyUrl: urlBad ? APPLY_URL_ERROR : null, rows, other: other?.message ?? null };
}

/** Save stays disabled while any inline error shows. */
export function hasDraftErrors(errors: DraftErrors): boolean {
    return errors.applyUrl !== null || errors.rows.size > 0 || errors.other !== null;
}

function firstFreePair(rows: readonly DraftWanted[], classes: readonly WowRecruitClass[]): Pick<DraftWanted, 'className' | 'role'> {
    const used = new Set(rows.map((r) => `${r.className}|${r.role}`));
    for (const className of classes) {
        for (const role of RECRUIT_ROLES) if (!used.has(`${className}|${role}`)) return { className, role };
    }
    return { className: 'Warrior', role: 'dps' };
}

/** Row edits for the wanted editor; a new row takes the first unused class + role and defaults to Open. */
export const wantedOps = {
    add: (rows: readonly DraftWanted[], classes: readonly WowRecruitClass[]): DraftWanted[] =>
        [...rows, { key: ++draftKey, ...firstFreePair(rows, classes), state: 'open', note: '' }],
    remove: (rows: readonly DraftWanted[], key: number): DraftWanted[] => rows.filter((r) => r.key !== key),
    patch: (rows: readonly DraftWanted[], key: number, patch: Partial<Omit<DraftWanted, 'key'>>): DraftWanted[] =>
        rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
};
