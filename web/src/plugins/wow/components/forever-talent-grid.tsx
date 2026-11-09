import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { formatForeverRank } from '../lib/forever-talent-trees';
import { armoryTreeNames } from '../lib/forever-armory-placement';
import { plural } from '../lib/plural';

type PositionedNode = ForeverTalentNodeDto & { tree: number; row: number; col: number };

const RANKED_CLASS = 'bg-overlay border border-edge text-foreground';
const MAXED_CLASS = 'bg-overlay border border-edge-strong font-medium text-foreground';
const UNRANKED_CLASS = 'bg-panel border border-edge-subtle text-dim';

function isPositioned(node: ForeverTalentNodeDto): node is PositionedNode {
    return node.tree !== undefined && node.row !== undefined && node.col !== undefined;
}

/** Token-only cell emphasis: maxed > ranked > rank 0 (R-C, R-D). */
function cellClass(node: ForeverTalentNodeDto): string {
    if (node.rank === 0) return UNRANKED_CLASS;
    return node.maxRanks !== undefined && node.rank >= node.maxRanks ? MAXED_CLASS : RANKED_CLASS;
}

function TalentCell({ node }: { node: PositionedNode }) {
    const label = node.name ?? `#${node.nodeId}`;
    return (
        <div data-testid="forever-talent-cell" title={label}
            className={`min-w-0 rounded px-1.5 py-1 text-[10px] leading-tight ${cellClass(node)}`}
            style={{ gridRow: node.row + 1, gridColumn: node.col + 1 }}>
            {/* Wraps, never truncates: a `title` alone is unreachable on touch and keyboard (ROK-1758). */}
            <span className="block break-words hyphens-auto">{label}</span>
            <span className="font-mono">{formatForeverRank(node)}</span>
        </div>
    );
}

interface OtherTalentsProps { testId: string; nodes: ForeverTalentNodeDto[]; treeless?: boolean }

/**
 * Ranked talents with no known cell (ROK-2113): named pills + a muted unnamed count; nothing when empty.
 * Under a tree it is that tree's sub-heading (h4); the tree-less block sits after all three grids as a
 * sibling of the tree headings (h3), separated by a rule so it does not read as part of the last tree.
 */
export function OtherTalents({ testId, nodes, treeless = false }: OtherTalentsProps) {
    if (nodes.length === 0) return null;
    const named = nodes.filter((n) => n.name);
    const unnamed = nodes.length - named.length;
    const Heading = treeless ? 'h3' : 'h4';
    return (
        <div data-testid={testId} className={treeless ? 'space-y-1.5 border-t border-edge-subtle pt-3' : 'space-y-1.5'}>
            <Heading className="text-xs font-medium text-muted">Other talents</Heading>
            <div className="flex flex-wrap gap-1.5">
                {named.map((n) => <span key={n.nodeId} className={`px-2 py-1 text-xs rounded ${RANKED_CLASS}`}>{`${n.name ?? ''} ${formatForeverRank(n)}`}</span>)}
            </div>
            {unnamed > 0 && <p className="text-xs text-muted">+{plural(unnamed, 'unnamed talent')}</p>}
        </div>
    );
}

interface SubTreeProps { name: string; index: number; spent: number; nodes: PositionedNode[]; other: ForeverTalentNodeDto[] }

function SubTree({ name, index, spent, nodes, other }: SubTreeProps) {
    const rows = Math.max(0, ...nodes.map((n) => n.row)) + 1;
    return (
        <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between text-sm">
                <h3 className="text-foreground font-medium">{name}</h3>
                <span data-testid={`forever-tree-spent-${index}`} className="text-muted font-mono">{spent}</span>
            </div>
            <div className="grid grid-cols-4 gap-1" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, auto))` }}>
                {nodes.map((node) => <TalentCell key={node.nodeId} node={node} />)}
            </div>
            <OtherTalents testId={`forever-other-talents-${index}`} nodes={other} />
        </div>
    );
}

function treeSpent(talents: ForeverTalentsDto, index: number, nodes: ForeverTalentNodeDto[]): number {
    const fromDto = talents.trees.find((t) => t.index === index)?.spent;
    return fromDto ?? nodes.reduce((sum, n) => sum + n.rank, 0);
}

/** Ranked nodes the known trees could not place (no row/col) — ROK-2113's per-talent fallback. */
function unplacedRanked(talents: ForeverTalentsDto): ForeverTalentNodeDto[] {
    return talents.nodes.filter((n) => n.rank > 0 && !isPositioned(n));
}

/**
 * WoW: Forever positioned talent grid (ROK-1744): three sub-trees side by side
 * at ≥md (stacked below), each a 4-column CSS grid of tiers. Empty positions
 * render nothing. Ranked nodes without a cell are listed as "Other talents"
 * below their tree's grid (ROK-2113), or after the trees when they have none.
 */
export function ForeverTalentGrid({ talents, characterClass }: { talents: ForeverTalentsDto; characterClass?: string | null | undefined }) {
    // ROK-2110 (D4/F3): Blizzard's `trees[].name` wins over the class table.
    const names = armoryTreeNames(talents, characterClass);
    const positioned = talents.nodes.filter(isPositioned);
    const unplaced = unplacedRanked(talents);
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[0, 1, 2].map((index) => {
                    const nodes = positioned.filter((n) => n.tree === index);
                    const other = unplaced.filter((n) => n.tree === index);
                    return <SubTree key={index} name={names[index] ?? `Tree ${index + 1}`} index={index} spent={treeSpent(talents, index, [...nodes, ...other])} nodes={nodes} other={other} />;
                })}
            </div>
            <OtherTalents testId="forever-other-talents-none" treeless nodes={unplaced.filter((n) => n.tree === undefined || n.tree > 2)} />
        </div>
    );
}
