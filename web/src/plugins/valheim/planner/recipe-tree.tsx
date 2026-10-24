/**
 * ROK-1854 — the requirement tree. The API sends flat nodes with `parentId`
 * links (no recursive schema); this folds them client-side and renders
 * nested lists with disclosure rows, every branch open by default.
 */
import { useMemo, useState, type JSX } from 'react';
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { foldNodes, pruneUndiscovered, type PlannerKind, type PlanTreeNode } from './planner.helpers';
import { RecipeTreeRow } from './recipe-tree-row';
import { rootKindOf, type PlannerNames } from './use-planner-names';

interface BranchProps {
    entries: PlanTreeNode[];
    names: PlannerNames;
    kindOf: (node: ValheimPlanNode) => PlannerKind;
    collapsed: ReadonlySet<number>;
    onToggle: (id: number) => void;
    label?: string;
}

function Branch({ entries, names, kindOf, collapsed, onToggle, label }: BranchProps): JSX.Element {
    return (
        <ul aria-label={label} className={label === undefined ? 'ml-5 border-l border-edge pl-2' : ''}>
            {entries.map(({ node, children }) => {
                const expanded = !collapsed.has(node.id);
                return (
                    <li key={node.id}>
                        <RecipeTreeRow
                            node={node}
                            kind={kindOf(node)}
                            names={names}
                            hasChildren={children.length > 0}
                            expanded={expanded}
                            onToggle={() => onToggle(node.id)}
                        />
                        {children.length > 0 && expanded && (
                            <Branch entries={children} names={names} kindOf={kindOf} collapsed={collapsed} onToggle={onToggle} />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/** Ids of the branches the user folded; every branch starts open. */
function useCollapsed(): { collapsed: ReadonlySet<number>; onToggle: (id: number) => void } {
    const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
    const onToggle = (id: number): void =>
        setCollapsed((cur) => {
            const next = new Set(cur);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    return { collapsed, onToggle };
}

export function RecipeTree({
    nodes,
    truncated,
    names,
    label,
    rootKinds,
    hideUndiscovered = false,
}: {
    nodes: readonly ValheimPlanNode[];
    truncated: boolean;
    names: PlannerNames;
    label: string;
    /** Target kinds in request order — root i is target i. */
    rootKinds: readonly (PlannerKind | undefined)[];
    /** ROK-1862 Q2 — already gated on `discovery === 'known'`: drop undiscovered nodes and their subtrees. */
    hideUndiscovered?: boolean;
}): JSX.Element {
    const roots = useMemo(() => (hideUndiscovered ? pruneUndiscovered(foldNodes(nodes)) : foldNodes(nodes)), [nodes, hideUndiscovered]);
    const kindOf = useMemo(() => rootKindOf(nodes, rootKinds), [nodes, rootKinds]);
    const { collapsed, onToggle } = useCollapsed();
    return (
        <div className="space-y-2">
            <Branch entries={roots} names={names} kindOf={kindOf} collapsed={collapsed} onToggle={onToggle} label={label} />
            {truncated && (
                <p className="text-xs text-muted">This tree is too large to show in full.</p>
            )}
        </div>
    );
}
