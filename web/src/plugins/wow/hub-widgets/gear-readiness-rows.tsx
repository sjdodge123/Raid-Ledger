/**
 * ROK-1915 (W7 + W8) — the parts of the "Gear readiness" card: the §4.30 CSS
 * item-level histogram over level-60 mains, and the two collapsed 44px
 * disclosures ("Below floor (55)" and "N of M checked mains" missing
 * enchants). Names are a `CharacterLink` to `/characters/:id` (spec Q4) —
 * the character page carries the Equipment section.
 */
import { useId, useState, type JSX, type ReactNode } from 'react';
import type { WowRosterGearDto } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { Button } from '../../../components/ui/button';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { GEAR_ROWS, gearAxis, gearBucketLabel, slotList } from './gear-readiness.helpers';

type Ilvl = WowRosterGearDto['ilvl'];
type Enchants = WowRosterGearDto['enchants'];
type Bucket = Ilvl['buckets'][number];

const NAME_CLASS = 'inline-block min-w-0 max-w-full truncate py-3 align-middle font-medium leading-5 text-foreground';
const ROW_CLASS = 'flex min-h-11 items-center justify-between gap-2 text-sm';

/** The uppercase section label of the mockup ("Item level · level 60 mains"). */
export function GearSectionLabel({ children }: { children: string }): JSX.Element {
    return <h4 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-dim first:mt-0">{children}</h4>;
}

function BucketBar({ b, max, isLast }: { b: Bucket; max: number; isLast: boolean }): JSX.Element {
    const height = max === 0 ? 0 : Math.max(b.count > 0 ? 4 : 0, Math.round((b.count / max) * 100));
    return (
        <a href="#members" data-testid={`forever-gear-bucket-${b.from}-${b.to}`} aria-label={gearBucketLabel(b, isLast)}
            className={`group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-sm ${FOCUS_RING}`}>
            <span aria-hidden="true" className="text-xs font-semibold text-foreground">{b.count}</span>
            <span aria-hidden="true" className="flex h-24 w-full items-end rounded-sm bg-overlay">
                <span className="block w-full rounded-sm bg-secondary group-hover:opacity-80" style={{ height: `${height}%` }} />
            </span>
            <span aria-hidden="true" className="w-full truncate text-center text-[10px] text-muted">{gearAxis(b, isLast)}</span>
        </a>
    );
}

/** §4.30 histogram of level-60 mains per item-level range. */
export function GearHistogram({ buckets }: { buckets: Ilvl['buckets'] }): JSX.Element {
    const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    return (
        <div role="group" aria-label="Level 60 mains per item-level range" className="flex items-end gap-1">
            {buckets.map((b, i) => <BucketBar key={`${b.from}-${b.to}`} b={b} max={max} isLast={i === buckets.length - 1} />)}
        </div>
    );
}

interface DisclosureProps {
    testId: string;
    label: string;
    count?: string;
    children: ReactNode;
}

/** A collapsed 44px row-wide toggle over an `edge` rule; the list renders only when open. */
function Disclosure({ testId, label, count, children }: DisclosureProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const listId = useId();
    return (
        <div data-testid={testId} className="border-t border-edge">
            <Button type="button" variant="bare" fullWidth aria-expanded={open} aria-controls={listId}
                onClick={() => setOpen((v) => !v)}
                className="min-h-11 justify-start rounded-sm text-left text-sm hover:opacity-80 [&>[data-button-label]]:w-full">
                <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
                    <span className="shrink-0 text-xs text-muted">{count === undefined ? '' : `${count} `}<span aria-hidden="true">{open ? '▴' : '▾'}</span></span>
                </span>
            </Button>
            {open && <div id={listId}>{children}</div>}
        </div>
    );
}

function MoreLine({ total, shown }: { total: number; shown: number }): JSX.Element | null {
    return total > shown ? <p className="pb-1.5 pl-3 text-xs text-dim">+{total - shown} more</p> : null;
}

/** "Below floor (55)": level-60 mains under the floor, lowest first. Nothing when nobody is below. */
export function BelowFloorSection({ ilvl }: { ilvl: Ilvl }): JSX.Element | null {
    if (ilvl.belowCount === 0) return null;
    const shown = ilvl.below.slice(0, GEAR_ROWS);
    return (
        <Disclosure testId="gear-below-floor" label={`Below floor (${ilvl.floor})`} count={String(ilvl.belowCount)}>
            <ul aria-label="Mains below the item-level floor" className="divide-y divide-edge pl-3">
                {shown.map((m) => (
                    <li key={m.characterId} data-testid="gear-below-row" className={ROW_CLASS}>
                        <CharacterLink name={m.name} characterId={m.characterId} className={NAME_CLASS} />
                        <span className="shrink-0 text-xs tabular-nums text-muted">{m.ilvl}</span>
                    </li>
                ))}
            </ul>
            <MoreLine total={ilvl.belowCount} shown={shown.length} />
        </Disclosure>
    );
}

/** "Missing enchants": one row per main naming the unenchanted slots, or a quiet all-clear line. */
export function MissingEnchantsSection({ enchants }: { enchants: Enchants }): JSX.Element | null {
    if (enchants.checked === 0) return null;
    if (enchants.missingCount === 0) {
        return <p className="text-sm text-muted">No missing enchants among {enchants.checked} checked mains.</p>;
    }
    return (
        <Disclosure testId="gear-missing-enchants" label={`${enchants.missingCount} of ${enchants.checked} checked mains`}>
            <ul aria-label="Mains missing enchants" className="divide-y divide-edge pl-3">
                {enchants.missing.map((m) => (
                    <li key={m.characterId} data-testid="gear-missing-row" className={ROW_CLASS}>
                        <CharacterLink name={m.name} characterId={m.characterId} className={NAME_CLASS} />
                        <span className="min-w-0 truncate text-right text-xs text-muted">{slotList(m.slots)}</span>
                    </li>
                ))}
            </ul>
            <MoreLine total={enchants.missingCount} shown={enchants.missing.length} />
        </Disclosure>
    );
}
