import type { JSX } from 'react';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { PriceBadge } from '../../components/games/PriceBadge';

/** Compact pricing summary shown inline in the game banner (ROK-419). */
export function GamePricingSummary({ pricing }: {
    pricing: ItadGamePricingDto;
}): JSX.Element | null {
    const { currentBest, historyLow, currency, itadUrl } = pricing;
    if (!currentBest) return null;

    return (
        <div className="mt-4 pt-3 border-t border-edge/30 space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-bold text-emerald-400">
                    {formatPrice(currentBest.price, currency)}
                </span>
                {currentBest.discount > 0 && (
                    <>
                        {currentBest.regularPrice != null && (
                        <span className="text-sm text-muted line-through">
                            {formatPrice(currentBest.regularPrice, currency)}
                        </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded">
                            -{currentBest.discount}%
                        </span>
                    </>
                )}
                <PriceBadge pricing={pricing} />
                {itadUrl && <ItadLink url={itadUrl} />}
            </div>
            {historyLow && <HistoryRow historyLow={historyLow} currency={currency} />}
        </div>
    );
}

function ItadLink({ url }: { url: string }): JSX.Element {
    return (
        <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors ml-auto">
            IsThereAnyDeal &rarr;
        </a>
    );
}

function HistoryRow({ historyLow, currency }: {
    historyLow: NonNullable<ItadGamePricingDto['historyLow']>;
    currency: string;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2 text-xs text-muted">
            <svg className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
            </svg>
            <span>
                Historical low: <span className="text-foreground font-medium">{formatPrice(historyLow.price, currency)}</span>
                {historyLow.shop && <>{' '}at {historyLow.shop}</>}
                {historyLow.date && <> ({formatDate(historyLow.date)})</>}
            </span>
        </div>
    );
}

function formatPrice(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

function formatDate(isoDate: string): string {
    try {
        return new Date(isoDate).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    } catch {
        return isoDate;
    }
}
