/**
 * ROK-1854 — one requirement row: icon, name, need / have / short, the
 * have/need meter and the via-chips ("Forge · lvl 3", "Smelter · 30 s",
 * "Gathered", "Loops back"…). Rows with children carry a disclosure button.
 */
import type { JSX } from 'react';
import type { ValheimPlanNode, ValheimRecipeSourceOption, ValheimStationBuilds } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { DiscoveryChip } from './discovery-chip';
import { HaveNeedBar } from './have-need-bar';
import { RecipeSteps } from './recipe-steps';
import { formatAmount, otherWaysCount, viaChips, type PlannerKind } from './planner.helpers';
import { isUndiscoveredNode, UNDISCOVERED_NODE_COPY } from './spoilers.helpers';
import type { PlannerNames } from './use-planner-names';

/** ROK-1860 — lets a multi-source row open the source picker (D7). */
export interface SourceChooser {
    /** The catalogue's `sourceOptions` for this prefab (items only). */
    optionsOf: (prefab: string, kind: PlannerKind) => readonly ValheimRecipeSourceOption[] | undefined;
    choose: (prefab: string) => void;
}

interface RowProps {
    node: ValheimPlanNode;
    kind: PlannerKind;
    names: PlannerNames;
    hasChildren: boolean;
    expanded: boolean;
    onToggle: () => void;
    /** ROK-1861: upgrade-station build costs from the response (display only). */
    stationBuilds?: ValheimStationBuilds | undefined;
    /** ROK-1860: the "+N other ways" chip becomes a picker button where the catalogue offers ≥2 sources. */
    onChooseSource?: SourceChooser | undefined;
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

function OtherWaysButton({ name, prefab, ways, onChoose }: { name: string; prefab: string; ways: number; onChoose: () => void }): JSX.Element {
    return (
        <Button variant="ghost" size="sm" aria-haspopup="dialog" aria-label={`Choose how to make ${name} (${ways} other ways)`}
            data-testid="valheim-planner-other-ways" data-prefab={prefab} onClick={onChoose}>
            +{ways} other ways
        </Button>
    );
}

interface ViaChipsProps {
    node: ValheimPlanNode;
    names: PlannerNames;
    name: string;
    onChoose: (() => void) | undefined;
}

function ViaChips({ node, names, name, onChoose }: ViaChipsProps): JSX.Element {
    const chips = viaChips(node, names.stationName);
    const ways = otherWaysCount(node);
    const button = onChoose !== undefined && ways > 0;
    // viaChips appends "+N other ways" last whenever ways > 0; the button replaces that chip.
    return (
        <div className="flex flex-wrap items-center gap-1">
            {(button ? chips.slice(0, -1) : chips).map((chip) => (
                // `whitespace-normal!`: StatusChip's own `whitespace-nowrap` sorts later in Tailwind 4's CSS, so a plain
                // override is a no-op. Lets "Armor upgrader · Upgrade station · lvl 3" wrap at 375px, not clip "lvl 3".
                <StatusChip key={chip} tone="neutral" title={chip} className="whitespace-normal!">
                    {chip}
                </StatusChip>
            ))}
            {button && <OtherWaysButton name={name} prefab={node.prefab} ways={ways} onChoose={onChoose} />}
        </div>
    );
}

/** D7: only an item the catalogue offers ≥2 sources for gets a picker (anyOneOf ingredients get no chooser from `RecipeTree`). */
function chooseHandler(node: ValheimPlanNode, kind: PlannerKind, chooser: SourceChooser | undefined): (() => void) | undefined {
    if (chooser === undefined || (chooser.optionsOf(node.prefab, kind)?.length ?? 0) < 2) return undefined;
    return () => chooser.choose(node.prefab);
}

/**
 * ROK-1948 D7 (operator ruling 2026-10-24): a withheld ingredient is NAMED like
 * the game names it ("Bronze × 5", name + icon) and marked not yet discovered —
 * no disclosure, children, have/need bar, station or "+N ways" chips.
 */
function UndiscoveredRow({ node, kind, names }: Pick<RowProps, 'node' | 'kind' | 'names'>): JSX.Element {
    const name = names.nameOf(node.prefab, kind);
    const ctx = names.ctxFor(node.prefab, kind);
    const resolved = { ...resolveItem(node.prefab, ctx.items, ctx.atlas), label: name };
    return (
        <div className="flex items-start gap-2 py-1.5" data-testid="valheim-planner-row-undiscovered" data-prefab={node.prefab}>
            <span className="w-11 shrink-0" aria-hidden="true" />
            <ItemIcon resolved={resolved} prefab={node.prefab} ctx={ctx} />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-foreground" data-testid="valheim-planner-row-name">
                        {name}
                    </span>
                    <Counts node={node} />
                </div>
                <p className="text-xs text-muted" data-testid="valheim-planner-row-undiscovered-note">
                    {UNDISCOVERED_NODE_COPY}
                </p>
            </div>
        </div>
    );
}

export function RecipeTreeRow({ node, kind, names, hasChildren, expanded, onToggle, stationBuilds, onChooseSource }: RowProps): JSX.Element {
    if (isUndiscoveredNode(node)) return <UndiscoveredRow node={node} kind={kind} names={names} />;
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
                    {node.discovered === false && <DiscoveryChip />}
                </div>
                <HaveNeedBar have={node.have} need={node.quantity} name={name} />
                <ViaChips node={node} names={names} name={name} onChoose={chooseHandler(node, kind, onChooseSource)} />
                {node.via.type === 'recipe' && node.via.steps !== undefined && (
                    <RecipeSteps steps={node.via.steps} builds={stationBuilds} names={names} />
                )}
            </div>
        </div>
    );
}
