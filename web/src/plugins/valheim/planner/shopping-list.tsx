/**
 * ROK-1854 — the shopping list: the chosen targets (each removable), the
 * leaves to gather (need / have / short), the cooking-fuel estimate line and
 * a "Copy list" button (plain text).
 */
import type { JSX } from 'react';
import type { ValheimRecipePlanResponse } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { CopyButton } from '../../../components/ui/CopyButton';
import {
    formatAmount,
    formatSeconds,
    shoppingListText,
    type PlannerTarget,
} from './planner.helpers';
import { HIDDEN_TARGET_COPY, PLAN_UNDISCOVERED_COPY, planHasUndiscovered } from './spoilers.helpers';
import type { PlannerNames } from './use-planner-names';

interface Props {
    targets: readonly PlannerTarget[];
    plan: ValheimRecipePlanResponse | undefined;
    names: PlannerNames;
    onRemove: (index: number) => void;
    /** ROK-1948 W5 — a stored target the protected catalogue no longer lists. */
    isHidden: (target: PlannerTarget) => boolean;
}

/** "q2" for a craft from scratch, "q1→2" for an upgrade step (ROK-1899). */
const qualityLabel = (t: PlannerTarget): string =>
    t.fromQuality > 0 ? `q${t.fromQuality}→${t.quality}` : `q${t.quality}`;

/** Never names the target: `nameOf` falls back to the raw prefab. */
function HiddenTarget({ onRemove }: { onRemove: () => void }): JSX.Element {
    return (
        <li className="flex items-center justify-between gap-2 text-sm text-muted" data-testid="valheim-planner-hidden-target">
            <span>{HIDDEN_TARGET_COPY}</span>
            <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove hidden item">
                Remove
            </Button>
        </li>
    );
}

const targetKey = (t: PlannerTarget): string => `${t.prefab}:${t.kind}:${t.quality}:${t.fromQuality}`;

function TargetList({ targets, names, onRemove, isHidden }: Omit<Props, 'plan'>): JSX.Element {
    return (
        <ul aria-label="Planned items" className="space-y-1">
            {targets.map((t, i) => {
                if (isHidden(t)) return <HiddenTarget key={targetKey(t)} onRemove={() => onRemove(i)} />;
                const name = names.nameOf(t.prefab, t.kind);
                return (
                    <li key={targetKey(t)} className="flex items-center justify-between gap-2 text-sm text-foreground">
                        <span>
                            {name}
                            {t.kind === 'item' && ` · ${qualityLabel(t)}`} × {formatAmount(t.amount)}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => onRemove(i)} aria-label={`Remove ${name}`}>
                            Remove
                        </Button>
                    </li>
                );
            })}
        </ul>
    );
}

function Leaves({ plan, names }: { plan: ValheimRecipePlanResponse; names: PlannerNames }): JSX.Element {
    return (
        <table className="w-full text-sm">
            <caption className="sr-only">What to gather</caption>
            <thead>
                <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-medium">Item</th>
                    <th className="py-1 text-right font-medium">Need</th>
                    <th className="py-1 text-right font-medium">Have</th>
                    <th className="py-1 text-right font-medium">Short</th>
                </tr>
            </thead>
            <tbody>
                {plan.shoppingList.map((l) => (
                    <tr key={l.prefab} className="border-t border-edge text-foreground">
                        <td className="py-1.5">{names.nameOf(l.prefab, 'item')}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatAmount(l.need)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatAmount(l.have)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatAmount(l.short)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function ShoppingList({ targets, plan, names, onRemove, isHidden }: Props): JSX.Element {
    if (targets.length === 0)
        return <p className="text-sm text-muted">Add an item to start a shopping list.</p>;
    return (
        <section aria-label="Shopping list" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Shopping list</h3>
                {plan !== undefined && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                        Copy list
                        <CopyButton text={shoppingListText(plan.shoppingList, (p) => names.nameOf(p, 'item'))} />
                    </span>
                )}
            </div>
            <TargetList targets={targets} names={names} onRemove={onRemove} isHidden={isHidden} />
            {plan !== undefined && <Leaves plan={plan} names={names} />}
            {plan !== undefined && planHasUndiscovered(plan.nodes) && (
                <p className="text-xs text-muted" data-testid="valheim-planner-undiscovered-footer">{PLAN_UNDISCOVERED_COPY}</p>
            )}
            {plan !== undefined && plan.fuelEstimates.length > 0 && (
                <p className="text-xs text-muted">
                    Fuel (estimate):{' '}
                    {plan.fuelEstimates
                        .map((f) => `${names.nameOf(f.prefab, 'item')} for ${formatSeconds(f.seconds)} of ${names.stationName(f.processor)}`)
                        .join(' · ')}
                </p>
            )}
        </section>
    );
}
