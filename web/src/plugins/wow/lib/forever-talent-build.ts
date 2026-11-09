/**
 * ROK-2150: a character's Forever build as a Wowhead calculator link (operator
 * 2026-11-09, overriding ROK-2146 D7's plain link).
 *
 * Wowhead's classic calculator (`TalentCalcClassic.js`) reads
 * `<hashVersion><tree0>-<tree1>-<tree2>`: one rank digit per talent in that tree's
 * row-then-col order, trees in calculator order (the table's order), trailing zeros
 * of each tree and trailing `-` trimmed (the calculator pads). `hashVersion` must be
 * the version the table's layout was extracted with — Wowhead translates an older
 * version's string through its own layout history, so a wrong stamp scrambles it.
 * Example: Protection Improved Bloodrage 2/2 + Shield Specialization 5/5 → `vkndmh--25`.
 */
import type { JoinedForeverTalents, JoinedTalent } from './forever-talent-table';
import { getWowheadTalentCalcUrl } from './wowhead-urls';

function byRowThenCol(a: JoinedTalent, b: JoinedTalent): number {
    return a.row - b.row || a.col - b.col;
}

/** One digit per talent; a rank outside 0..maxRank is clamped so a bad sync cannot break the string. */
function treeDigits(talents: readonly JoinedTalent[]): string {
    return [...talents].sort(byRowThenCol)
        .map((t) => String(Math.min(Math.max(Math.trunc(t.rank), 0), t.maxRank, 9)))
        .join('')
        .replace(/0+$/, '');
}

/** The calculator build string, or null when no point is spent (the bare calculator is the right link). */
export function foreverTalentBuildHash(joined: JoinedForeverTalents, hashVersion: string): string | null {
    const body = joined.trees.map((tree) => treeDigits(tree.talents)).join('-').replace(/-+$/, '');
    return body ? `${hashVersion}${body}` : null;
}

/**
 * The Forever calculator link for a class: with the build when the joined talents and
 * the table's hashVersion are known and a point is spent, else the bare calculator.
 */
export function getForeverTalentCalcUrl(
    className: string,
    joined: JoinedForeverTalents | null,
    hashVersion: string | null,
): string | null {
    const build = joined && hashVersion ? foreverTalentBuildHash(joined, hashVersion) : null;
    return getWowheadTalentCalcUrl(className, 'wow_forever', build);
}
