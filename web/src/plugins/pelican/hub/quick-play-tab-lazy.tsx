/**
 * ROK-1876 — the lazy shell registered as the server hub's Quick Play tab.
 * `register-hub.ts` loads with the Pelican plugin at boot, so a direct import
 * put the tab, its session row and date-fns' `formatDistanceStrict` in the
 * app-entry chunk (bundle budget); the tab now loads on first render. The
 * hub page has no Suspense boundary around a tab, so this shell owns one.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { QUICK_PLAY_LOADING } from './quick-play-loading';

const QuickPlayTab = lazy(() => import('./quick-play-tab').then((m) => ({ default: m.QuickPlayTab })));

/** The registered tab component — loads the Quick Play chunk on first render. */
export function LazyQuickPlayTab(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={QUICK_PLAY_LOADING}>
            <QuickPlayTab {...ctx} />
        </Suspense>
    );
}
