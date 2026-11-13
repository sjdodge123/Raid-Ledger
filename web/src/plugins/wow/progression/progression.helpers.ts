/**
 * ROK-1789 Part B — pure helpers for the Progression tab. Kept free of the
 * contract schema and React Query so `hub/register-hub.ts` can import the
 * visibility rule eagerly while the tab body stays a lazy chunk.
 */
import type { GuildPage } from '@raid-ledger/contract';
import { audienceAllows } from '../../hub-game-widgets';
import { isWowForeverSlug } from '../lib/forever-identity';

/**
 * Q-B15 + B10: WoW: Forever guilds only, for members and staff (the API's
 * `canView`); a visitor's `#progression` deep link falls back to Overview.
 */
export function progressionTabVisible({ page }: { page: Pick<GuildPage, 'guild' | 'viewer'> }): boolean {
    if (!isWowForeverSlug(page.guild.gameSlug)) return false;
    return audienceAllows('members', page.viewer) || page.viewer.isStaff === true;
}

/** "Nov 10" in the viewer's locale. */
export function shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
