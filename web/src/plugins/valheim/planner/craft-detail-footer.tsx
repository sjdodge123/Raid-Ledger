/**
 * ROK-1899 — the detail pane's footer (the in-game "Craft" button, spec
 * §3.1.3): in UPGRADE an "Upgrade to quality" `Select` over the entry's
 * upgrade steps, then the Amount `Input` and a full-width primary "Add to
 * list". CRAFT adds from scratch (`fromQuality` 0); UPGRADE adds the
 * `quality − 1 → quality` step.
 */
import { useState, type JSX } from 'react';
import type { ValheimRecipeCatalogEntry } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import type { CraftMode } from './crafting.helpers';
import { PLANNER_AMOUNT_MAX, PLANNER_TARGETS_MAX, type PlannerTarget } from './planner.helpers';

export interface CraftDetailFooterProps {
    mode: CraftMode;
    entry: ValheimRecipeCatalogEntry;
    /** UPGRADE: the step's target quality (ignored in CRAFT). */
    quality: number;
    onQuality: (quality: number) => void;
    /** Returns false when the add was refused (the list is at its cap). */
    onAdd: (target: PlannerTarget) => boolean;
    atCap: boolean;
}

/** The target "Add to list" writes: CRAFT from scratch at q1, UPGRADE `quality − 1 → quality`. */
function footerTarget(mode: CraftMode, entry: ValheimRecipeCatalogEntry, quality: number, amount: number): PlannerTarget {
    if (mode === 'upgrade') return { prefab: entry.prefab, kind: 'item', quality, fromQuality: quality - 1, amount };
    return { prefab: entry.prefab, kind: entry.kind, quality: 1, fromQuality: 0, amount };
}

function UpgradeSelect({ entry, quality, onQuality }: Pick<CraftDetailFooterProps, 'entry' | 'quality' | 'onQuality'>): JSX.Element {
    return (
        <Select aria-label="Upgrade to quality" value={String(quality)} onChange={(e) => onQuality(Number(e.target.value))} wrapperClassName="w-36">
            {entry.upgrades.map((u) => (
                <option key={u.quality} value={u.quality}>
                    Quality {u.quality}
                </option>
            ))}
        </Select>
    );
}

/** Upgrade-to (UPGRADE only), Amount and "Add to list". */
export function CraftDetailFooter({ mode, entry, quality, onQuality, onAdd, atCap }: CraftDetailFooterProps): JSX.Element {
    const [amount, setAmount] = useState('1');
    const n = Number(amount);
    const valid = Number.isInteger(n) && n >= 1 && n <= PLANNER_AMOUNT_MAX;
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                {mode === 'upgrade' && <UpgradeSelect entry={entry} quality={quality} onQuality={onQuality} />}
                <Input aria-label="Amount" type="number" min={1} max={PLANNER_AMOUNT_MAX} value={amount} invalid={!valid}
                    onChange={(e) => setAmount(e.target.value)} className="w-24" />
            </div>
            <Button variant="primary" className="w-full" disabled={!valid || atCap} onClick={() => onAdd(footerTarget(mode, entry, quality, n))}>
                Add to list
            </Button>
            {atCap && (
                <p role="status" className="text-xs text-muted">
                    Your list holds up to {PLANNER_TARGETS_MAX} targets — remove one to add another.
                </p>
            )}
        </div>
    );
}
