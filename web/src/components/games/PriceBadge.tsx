import type { ItadGamePricingDto } from '@raid-ledger/contract';

type BadgeType = 'best-price' | 'on-sale' | null;

/** Determine badge type from pricing data. */
export function getPriceBadgeType(pricing: ItadGamePricingDto | null): BadgeType {
    if (!pricing?.currentBest || pricing.currentBest.discount <= 0) return null;
    if (pricing.historyLow && pricing.currentBest.price <= pricing.historyLow.price) {
        return 'best-price';
    }
    return 'on-sale';
}

const BADGE_CONFIG: Record<NonNullable<BadgeType>, { label: string; className: string }> = {
    'best-price': { label: 'Best Price', className: 'bg-emerald-500/90 text-white' },
    'on-sale': { label: 'On Sale', className: 'bg-amber-500/90 text-white' },
};

/** Small pill badge indicating sale status. Used on game cards and detail pages. */
export function PriceBadge({ pricing, className = '' }: {
    pricing: ItadGamePricingDto | null;
    className?: string;
}): JSX.Element | null {
    const type = getPriceBadgeType(pricing);
    if (!type) return null;
    const config = BADGE_CONFIG[type];
    return (
        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${config.className} ${className}`}>
            {config.label}
        </span>
    );
}
