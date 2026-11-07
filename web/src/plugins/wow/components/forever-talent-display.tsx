import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { getWowheadTalentCalcUrl } from '../lib/wowhead-urls';
import { formatForeverRank } from '../lib/forever-talent-trees';
import { ForeverTalentGrid } from './forever-talent-grid';
import { TalentPillSection, WowheadCalcLink } from './talent-display';
import { plural } from '../lib/plural';
import { placeArmoryTalents } from '../lib/forever-armory-placement';

const PILL_CLASS = 'bg-overlay border border-edge text-foreground';

// TODO(ROK-1727 merge): use formatAddonSourceLine
function sourceLine(syncedAt: string): string {
    const date = new Date(syncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `via addon · ${date}`;
}

/** ROK-2110 AC6: "via Armory · 6 Nov 2026" for Blizzard-sourced talents; bare "via Armory" without a parseable date. */
function armorySourceLine(syncedAt: string): string {
    const date = new Date(syncedAt);
    if (Number.isNaN(date.getTime())) return 'via Armory';
    return `via Armory · ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function foreverSourceLine(talents: ForeverTalentsDto): string {
    return talents.source === 'blizzard' ? armorySourceLine(talents.syncedAt) : sourceLine(talents.syncedAt);
}

function ForeverHeader({ points, source, href }: { points: number; source: string; href: string | null }) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-mono font-bold text-foreground">{plural(points, 'point')}</span>
            <span data-testid="forever-talents-source" className="text-xs text-muted">{source}</span>
            {href && <WowheadCalcLink href={href} />}
        </div>
    );
}

/** List layout: named ranked nodes as pills + a muted unnamed count; summary only when nothing is named (R-A). */
function ForeverTalentList({ talents, points }: { talents: ForeverTalentsDto; points: number }) {
    const ranked = talents.nodes.filter((n) => n.rank > 0);
    const named = ranked.filter((n) => n.name);
    if (named.length === 0) return <p className="text-sm text-muted">{plural(points, 'point')} in {plural(ranked.length, 'talent')}</p>;
    const pills = named.map((n) => ({ name: `${n.name} ${formatForeverRank(n)}` }));
    const unnamed = ranked.length - named.length;
    return (
        <div className="space-y-2">
            <TalentPillSection label="Learned talents" talents={pills} pillClass={PILL_CLASS} />
            {unnamed > 0 && <p className="text-xs text-muted">+{plural(unnamed, 'unnamed talent')}</p>}
        </div>
    );
}

/**
 * Σ points for the header and list summary. The tree totals win when present:
 * the Blizzard converter drops a talent with no id/spellId from `nodes` but
 * keeps its rank in `trees[].spent`, so re-summing nodes would under-count.
 */
function totalPoints(talents: ForeverTalentsDto): number {
    if (talents.trees.length > 0) return talents.trees.reduce((sum, t) => sum + t.spent, 0);
    return talents.nodes.reduce((sum, n) => sum + n.rank, 0);
}

/**
 * WoW: Forever talents (ROK-1744; Blizzard source ROK-2110). Header (Σ rank,
 * source line, plain Forever calc link — hard-coded `wow_forever`, D7; no build
 * string, no iframe), then the positioned grid or the list/summary fallback.
 * Blizzard list payloads are placed on the known trees by name first (D5).
 */
export function ForeverTalentDisplay({ talents: raw, characterClass }: { talents: ForeverTalentsDto; characterClass?: string | null | undefined }) {
    const talents = placeArmoryTalents(raw, characterClass);
    const points = totalPoints(talents);
    const href = characterClass ? getWowheadTalentCalcUrl(characterClass, 'wow_forever') : null;
    return (
        <div className="space-y-4">
            <ForeverHeader points={points} source={foreverSourceLine(talents)} href={href} />
            {talents.layout === 'grid'
                ? <ForeverTalentGrid talents={talents} characterClass={characterClass} />
                : <ForeverTalentList talents={talents} points={points} />}
        </div>
    );
}
