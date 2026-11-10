/**
 * ROK-2152: the "Popular hubs" section both nav shells share (D5, §4.14 — one
 * set of components, two shells): a heading in the "Your hubs" style, then
 * `PopularHubRows`. Nothing at all while the list is empty, loading or failed
 * (D7, §4.6) — a nav list has no next step to offer.
 */
import type { JSX } from 'react';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { PopularHubRows, type GuildRowSize } from './hub-entry-bits';

interface Props {
    hubs: HubDirectoryEntry[];
    onNavigate?: (() => void) | undefined;
    /** `menuitem` inside the header's `role="menu"`. */
    role?: 'menuitem' | undefined;
    size: GuildRowSize;
    /** A top border, when the section follows the viewer's own rows (the phone sheet). */
    divided?: boolean;
}

const HEADING_PAD: Record<GuildRowSize, string> = { md: 'px-4', lg: 'px-5' };

export function PopularHubsSection({ hubs, onNavigate, role, size, divided = false }: Props): JSX.Element | null {
    if (hubs.length === 0) return null;
    return (
        <div role={role ? 'none' : undefined} data-testid="popular-hubs-section" className={divided ? 'border-t border-edge' : undefined}>
            <p role="presentation" data-testid="popular-hubs-heading"
                className={`${HEADING_PAD[size]} pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted`}>Popular hubs</p>
            <PopularHubRows hubs={hubs} onNavigate={onNavigate} role={role} size={size} />
        </div>
    );
}
