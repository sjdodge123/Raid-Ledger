/**
 * ROK-2146: the Wowhead-calculator-style WoW: Forever talent tree, drawn from the
 * static Forever table joined with a character's ranks (lib/forever-talent-table.ts),
 * and the tree-height placeholder shown while that table loads.
 */
import { useState, type CSSProperties } from 'react';
import { RadioGroup } from '../../../components/ui/radio-group';
import { useWowheadTooltips } from '../hooks/use-wowhead-tooltips';
import { mostPointsTreeIndex, type JoinedForeverTalents, type JoinedTalent, type JoinedTree } from '../lib/forever-talent-table';
import { OtherTalents } from './forever-talent-grid';

const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/medium/';
/** One cell + gap; `--ti` (icon) and `--tg` (gap) are set per breakpoint on the wrapper. */
const STEP = '(var(--ti) + var(--tg))';
/** Phone 44/18 (touch), md 36/12, lg 32/8 (three trees beside a 320px sidebar, with room for a classic scrollbar), xl 40/14. */
const SIZE_VARS = '[--ti:44px] [--tg:18px] md:[--ti:36px] md:[--tg:12px] lg:[--ti:32px] lg:[--tg:8px] xl:[--ti:40px] xl:[--tg:14px]';
/** Spent = talent gold via the warning token (gold dark, amber-800 light): a raw border/fill hue has no light remap. */
const SPENT_BORDER = 'border-warning';
const SPENT_TEXT = 'text-warning';

function TalentIcon({ talent }: { talent: JoinedTalent }) {
    const spent = talent.rank > 0;
    const style: CSSProperties = { left: `calc(${talent.col} * ${STEP})`, top: `calc(${talent.row} * ${STEP})`, width: 'var(--ti)', height: 'var(--ti)' };
    return (
        <a data-testid="forever-talent" data-spent={spent ? 'true' : 'false'} style={style}
            href={`https://www.wowhead.com/forever/spell=${talent.spellId}`} target="_blank" rel="noopener noreferrer"
            data-wowhead={`spell=${talent.spellId}&domain=forever`} aria-label={`${talent.name} ${talent.rank} of ${talent.maxRank}`}
            className={`absolute z-[2] rounded-md border-2 bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success ${spent ? SPENT_BORDER : 'border-edge-strong'}`}>
            <img src={`${ICON_BASE}${talent.icon}.jpg`} alt="" loading="lazy"
                className={`block w-full h-full rounded-sm ${spent ? '' : 'grayscale opacity-40'}`} />
            <span aria-hidden="true"
                className={`absolute -right-2 -bottom-2 z-[3] rounded px-1 py-0.5 text-[10px] leading-none font-semibold bg-surface border ${spent ? `${SPENT_BORDER} ${SPENT_TEXT}` : 'border-edge-strong text-dim'}`}>
                {`${talent.rank}/${talent.maxRank}`}
            </span>
        </a>
    );
}

interface ArrowSpec { key: string; from: JoinedTalent; to: JoinedTalent }

/** Prerequisite arrows within the tree; a prereq the tree lacks draws nothing. */
function treeArrows(tree: JoinedTree): ArrowSpec[] {
    return tree.talents.flatMap((to) => {
        const from = to.prereqSpellId === null ? undefined : tree.talents.find((t) => t.spellId === to.prereqSpellId);
        return from ? [{ key: `${from.spellId}-${to.spellId}`, from, to }] : [];
    });
}

/** A straight line between cells: down a column, or across a row (anything else draws nothing). */
function arrowStyle({ from, to }: ArrowSpec): CSSProperties | null {
    if (from.col === to.col && to.row > from.row) {
        return { left: `calc(${from.col} * ${STEP} + var(--ti) / 2 - 1px)`, top: `calc(${from.row + 1} * ${STEP} - var(--tg))`, width: '2px', height: `calc(${to.row - from.row - 1} * ${STEP} + var(--tg))` };
    }
    if (from.row === to.row && from.col !== to.col) {
        const left = Math.min(from.col, to.col);
        return { top: `calc(${from.row} * ${STEP} + var(--ti) / 2 - 1px)`, left: `calc(${left + 1} * ${STEP} - var(--tg))`, height: '2px', width: `calc(${Math.abs(to.col - from.col) - 1} * ${STEP} + var(--tg))` };
    }
    return null;
}

function Arrow({ spec }: { spec: ArrowSpec }) {
    const style = arrowStyle(spec);
    if (!style) return null;
    const spent = spec.to.rank > 0;
    return <span data-testid="forever-talent-arrow" data-spent={spent ? 'true' : 'false'} aria-hidden="true" style={style}
        className={`absolute z-[1] ${spent ? 'bg-warning' : 'bg-edge-strong'}`} />;
}

function TreeCard({ tree, hiddenOnPhone }: { tree: JoinedTree; hiddenOnPhone: boolean }) {
    const spent = tree.spent > 0;
    const grid: CSSProperties = { width: `calc(4 * var(--ti) + 3 * var(--tg))`, height: `calc(7 * var(--ti) + 6 * var(--tg))` };
    return (
        <section data-testid={`forever-tree-${tree.index}`} aria-label={`${tree.name} tree`}
            className={`${hiddenOnPhone ? 'hidden md:block' : ''} rounded-lg border bg-surface px-3.5 pt-2.5 pb-4 ${spent ? 'border-warning/50' : 'border-edge'}`}>
            <div className="mb-3 flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{tree.name}</h3>
                <span data-testid={`forever-tree-spent-${tree.index}`} aria-label={`${tree.spent} points`}
                    className={`ml-auto font-mono text-sm ${spent ? `${SPENT_TEXT} font-bold` : 'text-muted'}`}>{tree.spent}</span>
            </div>
            <div className="relative mx-auto" style={grid}>
                {treeArrows(tree).map((spec) => <Arrow key={spec.key} spec={spec} />)}
                {tree.talents.map((t) => <TalentIcon key={t.spellId} talent={t} />)}
            </div>
        </section>
    );
}

function TreeTabs({ trees, active, onChange }: { trees: JoinedTree[]; active: number; onChange: (index: number) => void }) {
    const options = trees.map((t) => ({ value: String(t.index), label: `${t.name} ${t.spent}` }));
    return (
        <RadioGroup label="Talent tree" hideLabel appearance="segmented" className="md:hidden"
            options={options} value={String(active)} onChange={(v) => onChange(Number(v))} />
    );
}

/** One tree card's height (header + 7 tiers + padding) in a neutral pulse, so the tree replaces it without a jump. */
export function ForeverTalentTreePlaceholder() {
    return (
        <div data-testid="forever-talents-loading" role="status" aria-label="Loading talent tree"
            className={`${SIZE_VARS} rounded-lg border border-edge bg-overlay animate-pulse motion-reduce:animate-none`}
            style={{ height: 'calc(7 * var(--ti) + 6 * var(--tg) + 4rem)' }} />
    );
}

/**
 * WoW: Forever talent tree, Wowhead-calculator style (ROK-2146 rulings 1 + 4): every
 * talent of the class at its tier/column, spent ones gold-bordered with an `x/y` badge,
 * unspent ones greyed `0/y`, prerequisite arrows and Wowhead spell tooltips. Three
 * trees side by side from `md`; below it, tree tabs opening on the most-points tree.
 */
export function ForeverTalentTree({ joined }: { joined: JoinedForeverTalents }) {
    const [active, setActive] = useState(() => mostPointsTreeIndex(joined.trees));
    useWowheadTooltips([joined]);
    return (
        <div className={`space-y-3 ${SIZE_VARS}`}>
            <TreeTabs trees={joined.trees} active={active} onChange={setActive} />
            <div className="md:flex md:flex-wrap md:justify-center gap-3">
                {joined.trees.map((tree) => <TreeCard key={tree.index} tree={tree} hiddenOnPhone={tree.index !== active} />)}
            </div>
            <OtherTalents testId="forever-other-talents-none" treeless nodes={joined.other} />
        </div>
    );
}
