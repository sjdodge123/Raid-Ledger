/**
 * ROK-2110 AC8: a WoW: Forever character whose stored Blizzard talents were
 * not converted server-side (null `lastSyncedAt`, or a shape the converter
 * rejected) still arrives as `format: 'classic'`. Forever characters never
 * render through the Classic tree display, so this maps that payload to a
 * Blizzard-sourced Forever `list` DTO for `ForeverTalentDisplay`. Pure.
 */
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';

/** The subset of the stored classic talents shape this mapping reads. */
export interface ClassicTalentsLike {
    trees: Array<{
        name: string;
        spentPoints: number;
        talents: Array<{ name: string; id?: number; spellId?: number; rank?: number }>;
    }>;
}

function toNodes(talents: ClassicTalentsLike): ForeverTalentNodeDto[] {
    return talents.trees.slice(0, 3).flatMap((tree, t) =>
        tree.talents.map((talent, i) => ({
            nodeId: talent.id ?? talent.spellId ?? (t + 1) * 1000 + i + 1,
            rank: talent.rank ?? 1,
            name: talent.name.slice(0, 64),
            tree: t,
        })),
    );
}

/** No sync date is known here, so `syncedAt` is empty and the header reads a bare "via Armory". */
export function classicToForeverList(talents: ClassicTalentsLike): ForeverTalentsDto {
    const trees = talents.trees.slice(0, 3).map((tree, index) => ({ index, spent: tree.spentPoints, name: tree.name }));
    return { format: 'forever', source: 'blizzard', syncedAt: '', layout: 'list', trees, nodes: toNodes(talents) };
}
