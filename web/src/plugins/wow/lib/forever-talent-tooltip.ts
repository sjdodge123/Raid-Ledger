/**
 * ROK-2150: the text a Forever talent tooltip shows. Forever reuses one spell id for
 * every rank, so Wowhead's spell tooltip cannot tell the ranks apart; the static table
 * carries Wowhead's calculator text per rank instead (`descriptions`, plain text).
 */
import type { ForeverTableTalent } from './forever-talent-table';

export interface ForeverTalentTooltipText {
    /** The spent rank's text; null at rank 0. */
    current: string | null;
    /** The next rank's text; null at max rank. At rank 0 this is rank 1's text. */
    next: string | null;
    /** The rank `current` describes: the spent rank clamped to 0..maxRank. */
    shownRank: number;
}

type TooltipTalent = Pick<ForeverTableTalent, 'maxRank' | 'descriptions'> & { rank: number };

/** Current and next rank text for a joined talent (rank 0 → next = rank 1; max rank → next = null). */
export function foreverTalentTooltipText(talent: TooltipTalent): ForeverTalentTooltipText {
    const shownRank = Math.min(Math.max(Math.trunc(talent.rank), 0), talent.maxRank);
    const current = shownRank > 0 ? talent.descriptions[shownRank - 1] ?? null : null;
    const next = shownRank < talent.maxRank ? talent.descriptions[shownRank] ?? null : null;
    return { current, next, shownRank };
}
