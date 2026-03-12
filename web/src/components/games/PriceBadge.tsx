import type { JSX } from 'react';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { getPriceBadgeType } from './price-badge.helpers';

const BADGE_CONFIG = {
    'best-price': { label: 'Best Price', className: 'bg-emerald-500/90 text-white' },
    'on-sale': { label: 'On Sale', className: 'bg-amber-500/90 text-white' },
} as const;

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
