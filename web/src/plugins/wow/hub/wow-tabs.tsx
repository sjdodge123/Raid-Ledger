/**
 * ROK-1830 — the WoW guild's tab components, adapted to `HubCtx`. The Raids
 * tab itself is unchanged (`raids-tab.tsx`); this only hands it the query the
 * shell already holds.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { audienceAllows } from '../../hub-game-widgets';
import { isWowForeverSlug } from '../lib/forever-identity';
import { GuildRaidsTab } from './raids-tab';

/** ROK-1789 Part B — the Progression tab body is its own chunk. */
const ProgressionTab = lazy(() => import('../progression/progression-tab'));

export function WowRaidsTab({ page, raids }: HubCtx): JSX.Element {
    return <GuildRaidsTab query={raids} page={page} />;
}

/** ROK-1789 Part B — the Forever guild's Progression tab (instances + activity feed). */
export function WowProgressionTab({ page }: HubCtx): JSX.Element {
    return <Suspense fallback={<div aria-busy="true" className="h-64 animate-pulse rounded-lg border border-edge bg-panel" />}><ProgressionTab page={page} /></Suspense>;
}

/**
 * Q-B15 + B10: WoW: Forever guilds only, for members and staff (the API's
 * `canView`); a visitor's `#progression` deep link falls back to Overview.
 */
export function progressionTabVisible({ page }: Pick<HubCtx, 'page'>): boolean {
    if (!isWowForeverSlug(page.guild.gameSlug)) return false;
    return audienceAllows('members', page.viewer) || page.viewer.isStaff === true;
}

/** A tab declared for the frame but not yet filled — never rendered (`visible: () => false`). */
export function HiddenTab(): null {
    return null;
}
