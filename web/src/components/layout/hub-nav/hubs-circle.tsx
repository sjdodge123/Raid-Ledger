/**
 * ROK-1875 (operator rulings 2026-10-21) — the green Hubs circle, shared by the
 * phone bar's raised centre button (`raised`, 56px) and the header's Hubs menu
 * trigger / plain link (`inline`, 28px). One look across phone and desktop:
 * `bg-success` + `text-white` (painted `--color-status-solid-label`, AA in both
 * families) around the grid icon. Always decorative (`aria-hidden`): the host
 * button or link carries the name and the focus ring.
 */
import type { JSX } from 'react';
import { Squares2X2Icon } from '@heroicons/react/24/solid';

export type HubsCircleSize = 'raised' | 'inline';

const BASE_CLASS = 'flex shrink-0 items-center justify-center rounded-full bg-success text-white';
/** The raised variant sits absolutely, 24px above the bar, centred in its slot; the host is a `group`. */
const SIZE_CLASS: Record<HubsCircleSize, string> = {
    raised: 'absolute -top-6 left-1/2 h-14 w-14 -translate-x-1/2 border-4 border-surface shadow-lg '
        + 'transition-transform duration-75 group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-success/50',
    inline: 'h-7 w-7',
};
const ICON_CLASS: Record<HubsCircleSize, string> = { raised: 'h-6 w-6', inline: 'h-4 w-4' };
/** Current route (`isHubsNavActive`) — the same ring on both sizes. */
const ACTIVE_RING = 'ring-2 ring-success/40 ring-offset-0';

interface HubsCircleProps { size: HubsCircleSize; active: boolean; testId: string }

/** The decorative Hubs circle; place it inside the button or link that owns the name. */
export function HubsCircle({ size, active, testId }: HubsCircleProps): JSX.Element {
    return (
        <span data-testid={testId} aria-hidden="true" className={`${BASE_CLASS} ${SIZE_CLASS[size]}${active ? ` ${ACTIVE_RING}` : ''}`}>
            <Squares2X2Icon className={ICON_CLASS[size]} />
        </span>
    );
}
