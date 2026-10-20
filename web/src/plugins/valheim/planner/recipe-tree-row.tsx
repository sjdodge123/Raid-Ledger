/**
 * ROK-1854 — one requirement row: icon, name, need / have / short, the
 * have/need meter and the via-chips ("Forge · lvl 3", "Smelter · 30 s",
 * "Gathered", "Loops back"…). Rows with children carry a disclosure button.
 */
import type { JSX } from 'react';
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { HaveNeedBar } from './have-need-bar';
import { formatAmount, viaChips } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

interface RowProps {
    node: ValheimPlanNode;
    names: PlannerNames;
    hasChildren: boolean;
    expanded: boolean;
    onToggle: () => void;
}

function Disclosure({ name, expanded, onToggle }: { name: string; expanded: boolean; onToggle: () => void }): JSX.Element {
    return (
        <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} what ${name} needs`}
            onClick={onToggle}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
        >
            <span aria-hidden="true" className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>
                ›
            </span>
        </button>
    );
}

function Counts({ node }: { node: ValheimPlanNode }): JSX.Element {
    return (
        <span className="text-xs text-muted tabular-nums">
            Need {formatAmount(node.quantity)} · Have {formatAmount(node.have)}
            {node.short !== null && node.short > 0 && (
                <span className="text-warning"> · Short {formatAmount(node.short)}</span>
            )}
        </span>
    );
}

export function RecipeTreeRow({ node, names, hasChildren, expanded, onToggle }: RowProps): JSX.Element {
    const name = names.nameOf(node.prefab);
    const ctx = names.ctxFor(node.prefab);
    const resolved = { ...resolveItem(node.prefab, ctx.items, ctx.atlas), label: name };
    return (
        <div className="flex items-start gap-2 py-1.5" data-testid="valheim-planner-row">
            {hasChildren ? (
                <Disclosure name={name} expanded={expanded} onToggle={onToggle} />
            ) : (
                <span className="w-11 shrink-0" aria-hidden="true" />
            )}
            <ItemIcon resolved={resolved} prefab={node.prefab} ctx={ctx} />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground">{name}</span>
                    <Counts node={node} />
                </div>
                <HaveNeedBar have={node.have} need={node.quantity} name={name} />
                <div className="flex flex-wrap gap-1">
                    {viaChips(node, names.stationName).map((chip) => (
                        <StatusChip key={chip} tone="neutral" title={chip}>
                            {chip}
                        </StatusChip>
                    ))}
                </div>
            </div>
        </div>
    );
}
