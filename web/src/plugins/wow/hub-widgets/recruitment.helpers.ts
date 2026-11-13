/**
 * ROK-1789 — pure helpers for the guild Recruitment card (L5 adds the editor's
 * draft helpers here). The headline state comes from the server view
 * (`recruitmentHeadline` in the contract), never re-derived on the web.
 */
import {
    WOW_CLASSIC_RECRUIT_CLASSES,
    WOW_RECRUIT_CLASSES,
    type GuildRecruitmentState,
    type GuildRecruitWanted,
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
