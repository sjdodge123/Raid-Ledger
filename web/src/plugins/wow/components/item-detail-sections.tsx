/**
 * ROK-2176: the sections of the shared item body (extracted from the
 * character-page `ItemDetailModal`). With `deltas`, every stat, armor and DPS
 * line carries a right-aligned change vs the equipped item.
 */
import type { ReactNode } from 'react';
import { CLASSIC_FALLBACK_HINT } from '../lib/item-wowhead-variant';
import { ARMOR_KEY, DPS_KEY, deltaTone, type StatDelta } from '../lib/item-stat-diff';
import type { DetailItem } from '../lib/item-detail-view';
import { Button } from '../../../components/ui/button';

const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500',
    COMMON: 'text-gray-300',
    UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400',
    EPIC: 'text-purple-400',
    LEGENDARY: 'text-orange-400',
};

const QUALITY_BORDER: Record<string, string> = {
    POOR: 'border-gray-500',
    COMMON: 'border-gray-400',
    UNCOMMON: 'border-green-500',
    RARE: 'border-blue-500',
    EPIC: 'border-purple-500',
    LEGENDARY: 'border-orange-500',
};

const TONE_CLASS = { up: 'text-success font-semibold', down: 'text-danger font-semibold', eq: 'text-muted font-medium' } as const;

export type DeltaByKey = ReadonlyMap<string, StatDelta>;

function formatNumber(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "▲ +12", "▼ −1%", "= same" — the prototype's `.d up/down/eq`. */
export function LineDelta({ delta, suffix = '' }: { delta: StatDelta | undefined; suffix?: string }) {
    if (!delta) return null;
    const tone = deltaTone(delta.value);
    const unit = delta.unit === 'percent' ? '%' : '';
    const abs = formatNumber(Math.abs(delta.value));
    const text = tone === 'eq' ? `= same${suffix}` : `${tone === 'up' ? '▲ +' : '▼ −'}${abs}${unit}${suffix}`;
    return <span className={`text-xs whitespace-nowrap ${TONE_CLASS[tone]}`} data-testid="line-delta" data-tone={tone}>{text}</span>;
}

function DeltaLine({ children, delta, className }: { children: ReactNode; delta: StatDelta | undefined; className: string }) {
    return (
        <div className={`flex items-baseline justify-between gap-2 text-sm ${className}`}>
            <span>{children}</span>
            <LineDelta delta={delta} />
        </div>
    );
}

export function ItemHeader({ item }: { item: DetailItem }) {
    return (
        <div className="flex items-start gap-3">
            {item.iconUrl && <img src={item.iconUrl} alt={item.name} width={40} height={40} loading="lazy" decoding="async" className={`w-10 h-10 rounded border-2 flex-shrink-0 ${QUALITY_BORDER[item.quality] ?? 'border-edge'}`} />}
            <div>
                <h3 className={`text-lg font-bold ${QUALITY_COLORS[item.quality] ?? 'text-gray-300'}`}>{item.name}</h3>
                {item.itemLevel != null && item.itemLevel > 0 && <div className="text-sm text-yellow-400">Item Level {item.itemLevel}</div>}
            </div>
        </div>
    );
}

export function ItemCombatInfo({ item, deltas }: { item: DetailItem; deltas?: DeltaByKey | undefined }) {
    return (
        <>
            {item.binding && <div className="text-sm text-muted">{item.binding}</div>}
            <div className="flex items-center justify-between text-sm text-muted"><span>{item.slotLabel}</span>{item.subclass && <span>{item.subclass}</span>}</div>
            {item.armor != null && item.armor > 0 && <DeltaLine delta={deltas?.get(ARMOR_KEY)} className="text-foreground">{item.armor} Armor</DeltaLine>}
            {item.weapon && (
                <div className="text-sm text-foreground space-y-0.5">
                    <div className="flex justify-between"><span>{item.weapon.damageMin} - {item.weapon.damageMax} Damage</span><span>Speed {item.weapon.attackSpeed.toFixed(2)}</span></div>
                    <DeltaLine delta={deltas?.get(DPS_KEY)} className="text-foreground">({item.weapon.dps.toFixed(1)} damage per second)</DeltaLine>
                </div>
            )}
        </>
    );
}

function statText(s: StatDelta): string {
    return `+${formatNumber(Math.abs(s.value))}${s.unit === 'percent' ? '%' : ''} ${s.name}`;
}

/** Stat lines; with `deltas`, equipped-only stats follow struck through (a loss). */
export function ItemStatLines({ item, deltas }: { item: DetailItem; deltas?: DeltaByKey | undefined }) {
    const stats = item.stats ?? [];
    const own = new Set(stats.map((s) => s.key));
    const lost = [...(deltas?.values() ?? [])].filter((d) => !own.has(d.key) && d.key !== ARMOR_KEY && d.key !== DPS_KEY);
    if (stats.length === 0 && lost.length === 0) return null;
    return (
        <div className="space-y-0.5" data-testid="item-stat-lines">
            {stats.map((s) => <DeltaLine key={s.key} delta={deltas?.get(s.key)} className="text-green-400">{statText(s)}</DeltaLine>)}
            {lost.map((d) => <DeltaLine key={d.key} delta={d} className="text-muted"><s>{statText(d)}</s> (equipped only)</DeltaLine>)}
        </div>
    );
}

export function ItemEnhancements({ item }: { item: DetailItem }) {
    return (
        <>
            {item.effects.length > 0 && <div className="space-y-0.5">{item.effects.map((e, i) => <div key={i} className="text-sm text-green-400">{e}</div>)}</div>}
            {item.enchantments.length > 0 && <div className="space-y-0.5">{item.enchantments.map((e, i) => <div key={i} className="text-sm text-green-400">{e}</div>)}</div>}
            {item.sockets.length > 0 && (
                <div className="flex items-center gap-1.5">
                    {item.sockets.map((s, i) => <span key={i} className={`w-4 h-4 rounded-full border-2 ${s.filled ? 'bg-blue-500/40 border-blue-500/60' : 'bg-faint border-edge'}`} title={`${s.socketType}${s.filled ? ' (filled)' : ' (empty)'}`} />)}
                </div>
            )}
        </>
    );
}

export function ItemFooter({ item }: { item: DetailItem }) {
    return (
        <>
            {item.requiredLevel != null && <div className="text-sm text-muted">Requires Level {item.requiredLevel}</div>}
            {item.setName && <div className="text-sm text-yellow-300">{item.setName}</div>}
            {item.description && <div className="text-sm text-yellow-600 italic">&quot;{item.description}&quot;</div>}
            {item.classicHint && <p className="text-xs text-muted">{CLASSIC_FALLBACK_HINT}</p>}
            <div className="pt-2 border-t border-edge">
                {/* ROK-2176: a button, not <a href=wowhead…> — Wowhead's tooltips.js binds to those links and spawns a second overlay. */}
                <Button variant="bare" onClick={() => window.open(item.wowheadUrl, '_blank', 'noopener,noreferrer')}
                    className="text-sm text-blue-400 hover:underline">
                    View on Wowhead <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </Button>
            </div>
        </>
    );
}
