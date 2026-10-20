/**
 * ROK-1854 — one requirement row: icon, name, need / have / short, the
 * have/need meter and the via-chips ("Forge · lvl 3", "Smelter · 30 s",
 * "Gathered", "Loops back"…). Rows with children carry a disclosure button.
 */
import type { JSX } from 'react';
import type { ValheimPlanNode } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { HaveNeedBar } from './have-need-bar';
import { formatAmount, viaChips, type PlannerKind } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

interface RowProps {
    node: ValheimPlanNode;
    kind: PlannerKind;
    names: PlannerNames;
    hasChildren: boolean;
    expanded: boolean;
    onToggle: () => void;
}

function Disclosure({ name, expanded, onToggle }: { name: string; expanded: boolean; onToggle: () => void }): JSX.Element {
    return (
        <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} what ${name} needs`}
            onClick={onToggle}
        >
            <span aria-hidden="true" className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>
                ›
            </span>
        </Button>
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

function ViaChips({ node, names }: { node: ValheimPlanNode; names: PlannerNames }): JSX.Element {
    return (
        <div className="flex flex-wrap gap-1">
            {viaChips(node, names.stationName).map((chip) => (
                <StatusChip key={chip} tone="neutral" title={chip}>
                    {chip}
                </StatusChip>
            ))}
        </div>
    );
}

export function RecipeTreeRow({ node, kind, names, hasChildren, expanded, onToggle }: RowProps): JSX.Element {
    const name = names.nameOf(node.prefab, kind);
    const ctx = names.ctxFor(node.prefab, kind);
    const resolved = { ...resolveItem(node.prefab, ctx.items, ctx.atlas), label: name };
    return (
        <div className="flex items-start gap-2 py-1.5" data-testid="valheim-planner-row" data-prefab={node.prefab}>
            {hasChildren ? (
                <Disclosure name={name} expanded={expanded} onToggle={onToggle} />
            ) : (
                <span className="w-11 shrink-0" aria-hidden="true" />
            )}
            <ItemIcon resolved={resolved} prefab={node.prefab} ctx={ctx} />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground" data-testid="valheim-planner-row-name">
                        {name}
                    </span>
                    <Counts node={node} />
                </div>
                <HaveNeedBar have={node.have} need={node.quantity} name={name} />
                <ViaChips node={node} names={names} />
            </div>
        </div>
    );
}
