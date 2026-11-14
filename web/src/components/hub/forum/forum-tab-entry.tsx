/**
 * ROK-1175 — a second lazy hop for the member Forum tab. `hub-page.tsx`
 * lazy-imports THIS tiny module, so the forum tab's long `__vite__mapDeps`
 * preload list (composer, thread view, markdown, FAB…) lives in this chunk
 * instead of the `hub-page` route chunk, which sits at its bundle budget.
 * The hub page's Suspense fallback covers both hops.
 */
import { lazy, type JSX } from 'react';
import type { HubForumTabProps } from './forum-tab';

const LazyHubForumTab = lazy(() => import('./forum-tab').then((m) => ({ default: m.HubForumTab })));

/** Renders the lazily loaded {@link HubForumTabProps Forum tab}. */
export function HubForumTabEntry(props: HubForumTabProps): JSX.Element {
    return <LazyHubForumTab {...props} />;
}
