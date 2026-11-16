/**
 * ROK-2216 — the "other-faction quests hidden" note (spec L10). The plan API
 * filters quests to one side and says where the side came from: the guild's
 * faction (`guild`) or the picked characters' shared side (`characters`).
 */
import type { DungeonPlanDto } from '@raid-ledger/contract';

type Side = 'alliance' | 'horde';

const SIDE_LABEL: Readonly<Record<Side, string>> = { alliance: 'Alliance', horde: 'Horde' };

/**
 * "2 Horde quests hidden — this is an Alliance guild." (side from the guild),
 * "2 Horde quests hidden for this group's faction." (side from the characters),
 * or null when nothing was hidden or no side applied.
 */
export function hiddenFactionNote(
    plan: Pick<DungeonPlanDto, 'hiddenOtherFaction' | 'side' | 'sideSource'>,
): string | null {
    const { hiddenOtherFaction: hidden, side, sideSource } = plan;
    if (hidden === 0 || side === null) return null;
    const other = SIDE_LABEL[side === 'alliance' ? 'horde' : 'alliance'];
    const lead = `${hidden} ${other} quest${hidden === 1 ? '' : 's'} hidden`;
    if (sideSource !== 'guild') return `${lead} for this group's faction.`;
    const article = side === 'alliance' ? 'an' : 'a';
    return `${lead} — this is ${article} ${SIDE_LABEL[side]} guild.`;
}
