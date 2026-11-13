/**
 * ROK-1830 — the WoW guild's tab components, adapted to `HubCtx`. The Raids
 * tab itself is unchanged (`raids-tab.tsx`); this only hands it the query the
 * shell already holds.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { ProgressionSkeleton } from '../progression/progression-skeleton';
import { GuildRaidsTab } from './raids-tab';

/** ROK-1789 Part B — the Progression tab body is its own chunk. */
const ProgressionTab = lazy(() => import('../progression/progression-tab'));

export function WowRaidsTab({ page, raids }: HubCtx): JSX.Element {
    return <GuildRaidsTab query={raids} page={page} />;
}

/** ROK-1789 Part B — the Forever guild's Progression tab (instances + activity feed). */
export function WowProgressionTab({ page }: HubCtx): JSX.Element {
    return <Suspense fallback={<ProgressionSkeleton />}><ProgressionTab page={page} /></Suspense>;
}

/** A tab declared for the frame but not yet filled — never rendered (`visible: () => false`). */
export function HiddenTab(): null {
    return null;
}
