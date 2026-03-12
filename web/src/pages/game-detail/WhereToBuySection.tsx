import type { JSX } from 'react';
import { useState } from 'react';
import { useGamePricing } from '../../hooks/use-games-discover';
import type { ItadGamePricingDto, DealQuality } from '@raid-ledger/contract';

interface WhereToBuySectionProps {
    gameId: number;
    hasItadId: boolean;
}

/** ROK-419: "Where to Buy" section showing prices across stores */
export function WhereToBuySection({ gameId, hasItadId }: WhereToBuySectionProps): JSX.Element | null {
    const { data: response, isLoading } = useGamePricing(gameId, hasItadId);
    const pricing = response?.data ?? null;

    if (!hasItadId) return null;
    if (isLoading) return <PricingSkeleton />;
    if (!pricing || pricing.stores.length === 0) return null;

    return (
        <section className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">Where to Buy</h2>
            <div className="bg-panel border border-edge rounded-lg p-4 space-y-4">
                <BestPriceRow pricing={pricing} />
                <HistoryLowRow pricing={pricing} />
                <StoreList stores={pricing.stores} currency={pricing.currency} />
            </div>
        </section>
    );
}

function PricingSkeleton(): JSX.Element {
    return (
        <section className="mb-8">
            <div className="h-6 bg-overlay rounded w-32 mb-3 animate-pulse" />
            <div className="bg-panel border border-edge rounded-lg p-4 space-y-3 animate-pulse">
                <div className="h-10 bg-overlay rounded" />
                <div className="h-8 bg-overlay rounded" />
            </div>
        </section>
    );
}

/** Current best price with deal quality badge */
function BestPriceRow({ pricing }: { pricing: ItadGamePricingDto }): JSX.Element | null {
    const { currentBest, dealQuality, currency } = pricing;
    if (!currentBest) return null;

    return (
        <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
                <span className="text-xl font-bold text-emerald-400">
                    {formatPrice(currentBest.price, currency)}
                </span>
                {currentBest.discount > 0 && (
                    <span className="text-sm text-muted line-through">
                        {formatPrice(currentBest.regularPrice, currency)}
                    </span>
                )}
                {currentBest.discount > 0 && (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded">
                        -{currentBest.discount}%
                    </span>
                )}
                <DealQualityBadge quality={dealQuality} />
            </div>
            <a href={currentBest.url} target="_blank" rel="noopener noreferrer"
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
                {currentBest.shop} &rarr;
            </a>
        </div>
    );
}

/** Historical low price row */
function HistoryLowRow({ pricing }: { pricing: ItadGamePricingDto }): JSX.Element | null {
    const { historyLow, currency } = pricing;
    if (!historyLow) return null;

    return (
        <div className="flex items-center gap-2 text-sm text-muted">
            <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
            </svg>
            <span>
                Historical low: <span className="text-foreground font-medium">{formatPrice(historyLow.price, currency)}</span>
                {' '}at {historyLow.shop}
                {' '}({formatDate(historyLow.date)})
            </span>
        </div>
    );
}

/** Expandable list of all store prices */
function StoreList({ stores, currency }: {
    stores: ItadGamePricingDto['stores'];
    currency: string;
}): JSX.Element | null {
    const [expanded, setExpanded] = useState(false);
    if (stores.length <= 1) return null;

    const sorted = [...stores].sort((a, b) => a.price - b.price);
    const visible = expanded ? sorted : sorted.slice(0, 3);

    return (
        <div>
            <div className="space-y-1.5">
                {visible.map((store) => (
                    <StoreRow key={store.shop} store={store} currency={currency} />
                ))}
            </div>
            {stores.length > 3 && (
                <button onClick={() => setExpanded(!expanded)}
                    className="mt-2 text-xs text-muted hover:text-foreground transition-colors bg-transparent border-none cursor-pointer p-0">
                    {expanded ? 'Show fewer' : `Show all ${stores.length} stores`}
                </button>
            )}
        </div>
    );
}

/** A single store row in the price list */
function StoreRow({ store, currency }: {
    store: ItadGamePricingDto['stores'][number];
    currency: string;
}): JSX.Element {
    return (
        <a href={store.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between p-2 rounded hover:bg-overlay transition-colors no-underline">
            <span className="text-sm text-foreground">{store.shop}</span>
            <div className="flex items-center gap-2">
                {store.discount > 0 && (
                    <span className="text-xs text-emerald-400 font-medium">-{store.discount}%</span>
                )}
                <span className="text-sm font-medium text-foreground">
                    {formatPrice(store.price, currency)}
                </span>
            </div>
        </a>
    );
}

/** Deal quality badge (green/yellow/gray) */
function DealQualityBadge({ quality }: { quality: DealQuality }): JSX.Element | null {
    if (!quality) return null;
    const config = DEAL_BADGE_CONFIG[quality];
    return (
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${config.className}`}>
            {config.label}
        </span>
    );
}

const DEAL_BADGE_CONFIG: Record<NonNullable<DealQuality>, { label: string; className: string }> = {
    great: { label: 'Near Historic Low', className: 'bg-emerald-500/20 text-emerald-400' },
    good: { label: 'Good Deal', className: 'bg-yellow-500/20 text-yellow-400' },
    modest: { label: 'On Sale', className: 'bg-gray-500/20 text-gray-400' },
};

/** Format a price amount with currency symbol */
function formatPrice(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

/** Format an ISO date string to a readable date */
function formatDate(isoDate: string): string {
    try {
        return new Date(isoDate).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    } catch {
        return isoDate;
    }
}
