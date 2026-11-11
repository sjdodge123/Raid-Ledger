/**
 * ROK-2176 layout A, desktop — the operator-approved prototype option A: both
 * item heads (Loot | Equipped | Change) over ONE aligned table, label | Loot |
 * Equipped | Δ, so a stat both items carry sits on one row. A key only one
 * side has shows "—" on the other; a side whose stats are unknown shows the
 * muted "Stats not synced" note in its own column. Phone keeps the stacked
 * columns (`item-compare-dialog.tsx`).
 */
import { useMemo, type ReactNode } from 'react';
import type { BossLootDto } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { ARMOR_KEY, DPS_KEY, formatStatValue, itemStatsView, sumViews, type StatDelta, type StatLine, type StatsView } from '../lib/item-stat-diff';
import { toDetailItem, type DetailItem } from '../lib/item-detail-view';
import { NOTE_STATS_NOT_SYNCED, ilvlDelta, lootNote, type LootComparison } from '../lib/loot-compare-model';
import { ItemHeader, LineDelta, TOOLTIP_GREEN, type DeltaByKey } from './item-detail-sections';

export const COMPARE_TAG = 'text-[0.625rem] font-bold uppercase tracking-wider text-dim';
const TD = 'px-2 py-1.5 border-b border-edge align-top text-left';
const HEAD = 'text-[0.6875rem] font-semibold uppercase tracking-wide text-dim';

type SideName = 'loot' | 'equipped';
interface Side { items: DetailItem[]; stats: Map<string, StatLine> | null; note: string | null }
interface Sides { loot: Side; equipped: Side }

export interface ItemCompareTableProps { loot: BossLootDto; comparison: LootComparison; gameVariant: string }

export function StatsUnknown({ text, side, className = '' }: { text: string; side: SideName; className?: string }) {
    return <div className={`px-2.5 py-2 rounded-lg bg-panel text-muted text-xs ${className}`} data-testid="stats-not-synced" data-side={side}>{text}</div>;
}

function statMap(view: StatsView | null): Map<string, StatLine> | null {
    return view ? new Map(view.stats.map((s) => [s.key, s])) : null;
}

function buildSides(loot: BossLootDto, comparison: LootComparison, gameVariant: string): Sides {
    const note = lootNote(loot, comparison);
    const eqItems = comparison.target.items;
    const eqView = eqItems.length > 0 ? sumViews(eqItems.map((i) => itemStatsView(i))) : null;
    return {
        loot: { items: [toDetailItem(loot, gameVariant)], stats: note ? null : statMap(itemStatsView(loot)), note },
        equipped: {
            items: eqItems.map((i) => toDetailItem(i, gameVariant)),
            stats: statMap(eqView),
            note: eqItems.length > 0 && !eqView ? NOTE_STATS_NOT_SYNCED : null,
        },
    };
}

/** One side's value for a row; several equipped items (Two-Hand vs MH + OH) join with " + ". */
function joined(items: DetailItem[], pick: (d: DetailItem) => string | number | null): string | null {
    const values = items.map(pick).filter((v): v is string | number => v !== null && v !== '');
    return values.length > 0 ? values.join(' + ') : null;
}

function Cell({ value, className = '' }: { value: ReactNode; className?: string }) {
    const empty = value === null || value === undefined;
    return <td className={`${TD} tabular-nums ${empty ? 'text-dim' : className}`}>{empty ? '—' : value}</td>;
}

interface RowProps { id: string; label: string; loot: ReactNode; equipped: ReactNode; delta?: StatDelta | undefined; className?: string }

function Row({ id, label, loot, equipped, delta, className = 'text-foreground' }: RowProps) {
    return (
        <tr data-testid="compare-row" data-row={id}>
            <th scope="row" className={`${TD} font-normal text-muted`}>{label}</th>
            <Cell value={loot} className={className} />
            <Cell value={equipped} className={className} />
            <td className={`${TD} text-right`}><LineDelta delta={delta} /></td>
        </tr>
    );
}

function GroupRow({ label }: { label: string }) {
    return <tr><th scope="colgroup" colSpan={4} className={`${TD} bg-panel ${HEAD}`}>{label}</th></tr>;
}

const slotType = (d: DetailItem) => [d.slotLabel, d.subclass].filter(Boolean).join(' · ') || null;

function BasicRows({ sides, ilvl }: { sides: Sides; ilvl: StatDelta | undefined }) {
    const { loot: l, equipped: e } = sides;
    const level = (d: DetailItem) => (d.itemLevel ? d.itemLevel : null);
    return (
        <>
            <Row id="ILVL" label="Item level" loot={joined(l.items, level)} equipped={joined(e.items, level)} delta={ilvl} />
            <Row id="BINDING" label="Binding" loot={joined(l.items, (d) => d.binding)} equipped={joined(e.items, (d) => d.binding)} />
            <Row id="SLOT" label="Slot / type" loot={joined(l.items, slotType)} equipped={joined(e.items, slotType)} />
        </>
    );
}

function WeaponRows({ sides, deltas }: { sides: Sides; deltas: DeltaByKey | undefined }) {
    const { loot: l, equipped: e } = sides;
    if (![...l.items, ...e.items].some((d) => d.weapon)) return null;
    const damage = (d: DetailItem) => (d.weapon ? `${d.weapon.damageMin} - ${d.weapon.damageMax}` : null);
    const speed = (d: DetailItem) => (d.weapon ? d.weapon.attackSpeed.toFixed(2) : null);
    const dps = (d: DetailItem) => (d.weapon ? d.weapon.dps.toFixed(1) : null);
    return (
        <>
            <GroupRow label="Weapon" />
            <Row id="DAMAGE" label="Damage" loot={joined(l.items, damage)} equipped={joined(e.items, damage)} />
            <Row id="SPEED" label="Speed" loot={joined(l.items, speed)} equipped={joined(e.items, speed)} />
            <Row id="DPS" label="DPS" loot={joined(l.items, dps)} equipped={joined(e.items, dps)} delta={deltas?.get(DPS_KEY)} />
        </>
    );
}

function ArmorRow({ sides, deltas }: { sides: Sides; deltas: DeltaByKey | undefined }) {
    const armor = (d: DetailItem) => (d.armor ? d.armor : null);
    const lootArmor = joined(sides.loot.items, armor);
    const eqArmor = joined(sides.equipped.items, armor);
    if (lootArmor === null && eqArmor === null) return null;
    return <Row id="ARMOR" label="Armor" loot={lootArmor} equipped={eqArmor} delta={deltas?.get(ARMOR_KEY)} />;
}

function statKeys(sides: Sides): { key: string; name: string }[] {
    const names = new Map<string, string>();
    for (const side of [sides.loot, sides.equipped]) {
        for (const s of side.stats?.values() ?? []) if (!names.has(s.key)) names.set(s.key, s.name);
    }
    return [...names].map(([key, name]) => ({ key, name }));
}

function statCell(side: Side, which: SideName, key: string, rowIndex: number, span: number): ReactNode {
    if (side.note) {
        if (rowIndex > 0) return null;
        return <td key={which} rowSpan={span} className={TD}><StatsUnknown text={side.note} side={which} /></td>;
    }
    const s = side.stats?.get(key);
    return <Cell key={which} value={s ? formatStatValue(s.value, s.unit) : null} className={TOOLTIP_GREEN} />;
}

function StatRows({ sides, deltas }: { sides: Sides; deltas: DeltaByKey | undefined }) {
    const keys = statKeys(sides);
    if (keys.length === 0 && !sides.loot.note && !sides.equipped.note) return null;
    const rows = keys.length > 0 ? keys : [{ key: 'NO_STATS', name: '' }];
    return (
        <>
            <GroupRow label="Stats" />
            {rows.map((r, i) => (
                <tr key={r.key} data-testid="compare-row" data-row={r.key}>
                    <th scope="row" className={`${TD} font-normal text-muted`}>{r.name}</th>
                    {statCell(sides.loot, 'loot', r.key, i, rows.length)}
                    {statCell(sides.equipped, 'equipped', r.key, i, rows.length)}
                    <td className={`${TD} text-right`}><LineDelta delta={deltas?.get(r.key)} /></td>
                </tr>
            ))}
        </>
    );
}

function lines(items: DetailItem[], pick: (d: DetailItem) => string[]): ReactNode {
    const all = items.flatMap(pick);
    return all.length > 0 ? <div className="space-y-0.5">{all.map((t, i) => <div key={i}>{t}</div>)}</div> : null;
}

function ExtraRows({ sides }: { sides: Sides }) {
    const { loot: l, equipped: e } = sides;
    const effects = { loot: lines(l.items, (d) => d.effects), eq: lines(e.items, (d) => d.effects) };
    const enchants = { loot: lines(l.items, (d) => d.enchantments), eq: lines(e.items, (d) => d.enchantments) };
    const req = (d: DetailItem) => d.requiredLevel;
    return (
        <>
            {(effects.loot || effects.eq) && <Row id="EFFECTS" label="Effects" loot={effects.loot} equipped={effects.eq} className={TOOLTIP_GREEN} />}
            {(enchants.loot || enchants.eq) && <Row id="ENCHANT" label="Enchant" loot={enchants.loot} equipped={enchants.eq} className={TOOLTIP_GREEN} />}
            <Row id="REQ" label="Requires level" loot={joined(l.items, req)} equipped={joined(e.items, req)} />
        </>
    );
}

function Heads({ sides, target }: { sides: Sides; target: LootComparison['target'] }) {
    const eq = sides.equipped.items;
    const empty = target.mode === 'none' ? 'Nothing to compare against' : 'Nothing equipped in this slot';
    return (
        <div className="grid grid-cols-[1fr_1fr_4.5rem] gap-x-3 items-start mb-3">
            <section data-testid="compare-loot-column" aria-label="Loot">
                <div className={`${COMPARE_TAG} mb-1`}>Loot</div>
                {sides.loot.items.map((d) => <ItemHeader key={d.name} item={d} />)}
            </section>
            <section data-testid="compare-equipped-column" aria-label={target.label ? `Equipped — ${target.label}` : 'Equipped'}>
                <div className={COMPARE_TAG}>Equipped</div>
                {target.label && <div className="text-xs text-muted mb-1">{target.label}</div>}
                {eq.length === 0 && <div className="text-sm text-muted">{empty}</div>}
                <div className="space-y-2">{eq.map((d, i) => <ItemHeader key={`${d.name}-${i}`} item={d} />)}</div>
            </section>
            <div className={`${COMPARE_TAG} text-right`} aria-hidden="true">Change</div>
        </div>
    );
}

function WowheadButton({ item, label }: { item: DetailItem; label: string }) {
    return (
        <Button variant="bare" onClick={() => window.open(item.wowheadUrl, '_blank', 'noopener,noreferrer')} className="text-sm text-blue-400 hover:underline">
            {label} <span aria-hidden="true">↗</span>
        </Button>
    );
}

function WowheadButtons({ sides }: { sides: Sides }) {
    const eq = sides.equipped.items;
    const eqLabel = (d: DetailItem) => `${eq.length > 1 ? (d.slotLabel ?? 'Equipped') : 'Equipped'} on Wowhead`;
    return (
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2 mt-3 border-t border-edge">
            {sides.loot.items.map((d) => <WowheadButton key="loot" item={d} label="Loot on Wowhead" />)}
            {eq.map((d, i) => <WowheadButton key={`eq-${i}`} item={d} label={eqLabel(d)} />)}
        </div>
    );
}

/** Desktop body of `ItemCompareDialog` — see file docstring. */
export function ItemCompareTable({ loot, comparison, gameVariant }: ItemCompareTableProps) {
    const sides = useMemo(() => buildSides(loot, comparison, gameVariant), [loot, comparison, gameVariant]);
    const deltas = useMemo(() => (comparison.deltas ? new Map(comparison.deltas.map((d) => [d.key, d])) : undefined), [comparison.deltas]);
    return (
        <div data-testid="item-compare-dialog" data-layout="table">
            <Heads sides={sides} target={comparison.target} />
            <table className="w-full border-collapse text-[0.8125rem]" data-testid="compare-table">
                <caption className="sr-only">{loot.itemName} compared with your equipped item</caption>
                <thead>
                    <tr>
                        <th scope="col" className={`${TD} w-[26%]`}><span className="sr-only">Attribute</span></th>
                        <th scope="col" className={`${TD} ${HEAD}`}>Loot</th>
                        <th scope="col" className={`${TD} ${HEAD}`}>Equipped</th>
                        <th scope="col" className={`${TD} ${HEAD} text-right`}><span aria-hidden="true">Δ</span><span className="sr-only">Change</span></th>
                    </tr>
                </thead>
                <tbody>
                    <BasicRows sides={sides} ilvl={ilvlDelta(loot, comparison)} />
                    <WeaponRows sides={sides} deltas={deltas} />
                    <ArmorRow sides={sides} deltas={deltas} />
                    <StatRows sides={sides} deltas={deltas} />
                    <ExtraRows sides={sides} />
                </tbody>
            </table>
            <WowheadButtons sides={sides} />
        </div>
    );
}
