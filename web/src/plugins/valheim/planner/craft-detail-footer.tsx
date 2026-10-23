/**
 * ROK-1899 — the detail pane's footer (the in-game "Craft" button, spec
 * §3.1.3): in UPGRADE an "Upgrade to quality" `Select` over the entry's
 * upgrade steps on its own line, then ONE row: a fixed Amount box (72px
 * phone / 84px desktop — `w-18` / `lg:w-21`) and the primary "Add to list"
 * filling the rest, so it stays full-width of what remains (spec §3.3,
 * approved mockup). The Input frame is `w-full`, so the box sets the width. Amount is
 * controlled by the detail, whose breakdown plans the same amount. CRAFT adds from scratch (`fromQuality` 0); UPGRADE adds the
 * `quality − 1 → quality` step.
 */
import type { JSX } from 'react';
import type { ValheimRecipeCatalogEntry } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import type { CraftMode } from './crafting.helpers';
import { parseAmount } from './craft-detail.helpers';
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
    /** The Amount box's raw text (controlled by the detail). */
    amount: string;
    onAmount: (amount: string) => void;
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
export function CraftDetailFooter({ mode, entry, quality, onQuality, onAdd, atCap, amount, onAmount }: CraftDetailFooterProps): JSX.Element {
    const n = parseAmount(amount);
    const valid = n !== null;
    return (
        <div className="w-full space-y-2">
            {mode === 'upgrade' && <UpgradeSelect entry={entry} quality={quality} onQuality={onQuality} />}
            <div className="flex items-center gap-2">
                <div className="w-18 shrink-0 lg:w-21">
                    <Input aria-label="Amount" type="number" min={1} max={PLANNER_AMOUNT_MAX} value={amount} invalid={!valid}
                        onChange={(e) => onAmount(e.target.value)} />
                </div>
                <Button variant="primary" className="min-w-0 flex-1" disabled={!valid || atCap} onClick={() => n !== null && onAdd(footerTarget(mode, entry, quality, n))}>
                    Add to list
                </Button>
            </div>
            {atCap && (
                <p role="status" className="text-xs text-muted">
                    Your list holds up to {PLANNER_TARGETS_MAX} targets — remove one to add another.
                </p>
            )}
        </div>
    );
}
