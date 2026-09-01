import type { JSX } from 'react';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import {
    getPriceBadgeType,
    getPriceBadgeTypeFromScalars,
    type BadgeType,
    type PriceBadgeScalars,
} from './price-badge.helpers';

const BADGE_CONFIG = {
    'best-price': { label: 'Best Price', className: 'bg-emerald-500/90 text-white' },
    'on-sale': { label: 'On Sale', className: 'bg-amber-500/90 text-white' },
} as const;

const CHIP_CLS = 'px-1.5 py-0.5 text-[10px] font-bold rounded';

/**
 * ROK-1314: the ONE price presentation. `showPrice` appends the figure
 * (`· $19.99 (-40%)`); it never changes the locked `Best Price` / `On Sale`
 * label (spec §0/§5.2).
 */
function PriceChip({
    type,
    price,
    cut,
    className,
    showPrice,
}: {
    type: BadgeType;
    price: number | null | undefined;
    cut: number | null | undefined;
    className: string;
    showPrice: boolean;
}): JSX.Element | null {
    if (!type) return null;
    const config = BADGE_CONFIG[type];
    const discount = cut != null && cut > 0 ? ` (-${cut}%)` : '';
    const suffix = showPrice && price != null ? ` · $${price.toFixed(2)}${discount}` : '';
    return (
        <span className={`${CHIP_CLS} ${config.className} ${className}`}>
            {`${config.label}${suffix}`}
        </span>
    );
}

/** Small pill badge indicating sale status. Used on game cards and detail pages. */
export function PriceBadge({ pricing, className = '', showPrice = false }: {
    pricing: ItadGamePricingDto | null;
    className?: string;
    /** ROK-1314: append `· $19.99 (-40%)` — Common Ground / nomination cards. */
    showPrice?: boolean;
}): JSX.Element | null {
    return (
        <PriceChip
            type={getPriceBadgeType(pricing)}
            price={pricing?.currentBest?.price ?? null}
            cut={pricing?.currentBest?.discount ?? null}
            className={className}
            showPrice={showPrice}
        />
    );
}

/**
 * Same badge, fed from the loose scalars the lineup / Common Ground DTOs
 * carry. Routes through the identical rule — this is a second *entry point*,
 * not a second implementation (spec §5.2).
 */
export function ScalarPriceBadge({
    cut,
    price,
    lowestPrice,
    className = '',
    showPrice = false,
}: PriceBadgeScalars & { className?: string; showPrice?: boolean }): JSX.Element | null {
    return (
        <PriceChip
            type={getPriceBadgeTypeFromScalars({ cut, price, lowestPrice })}
            price={price}
            cut={cut}
            className={className}
            showPrice={showPrice}
        />
    );
}

/**
 * Neutral price tag for the no-discount case (spec §5.2). Deliberately NOT a
 * sale badge: the sale vocabulary stays two-valued and un-diluted, while the
 * plain `$X` information the old `SaleBadge`/`DealBadge` chips carried is
 * preserved.
 */
export function PriceTag({ price, className = '' }: {
    price: number | null | undefined;
    className?: string;
}): JSX.Element | null {
    if (price == null) return null;
    return (
        <span className={`${CHIP_CLS} bg-zinc-600/80 text-white ${className}`}>
            ${price.toFixed(2)}
        </span>
    );
}
