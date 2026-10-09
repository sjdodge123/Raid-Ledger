import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { getWowheadTalentCalcUrl } from '../lib/wowhead-urls';
import { ForeverTalentGrid, formatForeverRank } from './forever-talent-grid';
import { TalentPillSection, WowheadCalcLink } from './talent-display';

const PILL_CLASS = 'bg-overlay border border-edge text-foreground';

// TODO(ROK-1727 merge): use formatAddonSourceLine
function sourceLine(syncedAt: string): string {
    const date = new Date(syncedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `via addon · ${date}`;
}

function ForeverHeader({ points, syncedAt, href }: { points: number; syncedAt: string; href: string | null }) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-mono font-bold text-foreground">{points} points</span>
            <span className="text-xs text-muted">{sourceLine(syncedAt)}</span>
            {href && <WowheadCalcLink href={href} />}
        </div>
    );
}

/** List layout: named ranked nodes as pills + a muted unnamed count; summary only when nothing is named (R-A). */
function ForeverTalentList({ talents, points }: { talents: ForeverTalentsDto; points: number }) {
    const ranked = talents.nodes.filter((n) => n.rank > 0);
    const named = ranked.filter((n) => n.name);
    if (named.length === 0) return <p className="text-sm text-muted">{points} points in {ranked.length} talents</p>;
    const pills = named.map((n) => ({ name: `${n.name} ${formatForeverRank(n)}` }));
    const unnamed = ranked.length - named.length;
    return (
        <div className="space-y-2">
            <TalentPillSection label="Talents" talents={pills} pillClass={PILL_CLASS} />
            {unnamed > 0 && <p className="text-xs text-muted">+{unnamed} unnamed talents</p>}
        </div>
    );
}

/**
 * WoW: Forever addon-sourced talents (ROK-1744). Header (Σ rank, source line,
 * plain Forever calc link — hard-coded `wow_forever`, D7; no build string, no
 * iframe), then the positioned grid or the list/summary fallback.
 */
export function ForeverTalentDisplay({ talents, characterClass }: { talents: ForeverTalentsDto; characterClass?: string | null }) {
    const points = talents.nodes.reduce((sum, n) => sum + n.rank, 0);
    const href = characterClass ? getWowheadTalentCalcUrl(characterClass, 'wow_forever') : null;
    return (
        <div className="space-y-4">
            <ForeverHeader points={points} syncedAt={talents.syncedAt} href={href} />
            {talents.layout === 'grid'
                ? <ForeverTalentGrid talents={talents} characterClass={characterClass} />
                : <ForeverTalentList talents={talents} points={points} />}
        </div>
    );
}
