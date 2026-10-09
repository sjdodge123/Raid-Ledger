import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { foreverTreeNames, formatForeverRank } from '../lib/forever-talent-trees';

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
            <span className="block truncate">{label}</span>
            <span className="font-mono">{formatForeverRank(node)}</span>
        </div>
    );
}

function SubTree({ name, index, spent, nodes }: { name: string; index: number; spent: number; nodes: PositionedNode[] }) {
    const rows = Math.max(0, ...nodes.map((n) => n.row)) + 1;
    return (
        <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between text-sm">
                <h4 className="text-foreground font-medium">{name}</h4>
                <span data-testid={`forever-tree-spent-${index}`} className="text-muted font-mono">{spent}</span>
            </div>
            <div className="grid grid-cols-4 gap-1" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, auto))` }}>
                {nodes.map((node) => <TalentCell key={node.nodeId} node={node} />)}
            </div>
        </div>
    );
}

function treeSpent(talents: ForeverTalentsDto, index: number, nodes: PositionedNode[]): number {
    const fromDto = talents.trees.find((t) => t.index === index)?.spent;
    return fromDto ?? nodes.reduce((sum, n) => sum + n.rank, 0);
}

/**
 * WoW: Forever positioned talent grid (ROK-1744): three sub-trees side by side
 * at ≥md (stacked below), each a 4-column CSS grid of tiers. Empty positions
 * render nothing. Expects `layout === 'grid'` (every node positioned).
 */
export function ForeverTalentGrid({ talents, characterClass }: { talents: ForeverTalentsDto; characterClass?: string | null | undefined }) {
    const names = foreverTreeNames(characterClass);
    const positioned = talents.nodes.filter(isPositioned);
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((index) => {
                const nodes = positioned.filter((n) => n.tree === index);
                return <SubTree key={index} name={names[index] ?? `Tree ${index + 1}`} index={index} spent={treeSpent(talents, index, nodes)} nodes={nodes} />;
            })}
        </div>
    );
}
