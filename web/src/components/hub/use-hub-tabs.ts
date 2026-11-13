/**
 * ROK-1790 — the hub frame's tab list, kept live. A tab's `visible(ctx)` is a
 * plain predicate (not a hook), so one that reads the query cache — the WoW
 * Crafters tab peeks at roster insights another widget fetched — would only
 * be re-evaluated when something else re-rendered the frame. This hook
 * subscribes to the QueryCache and re-renders the frame only when the set of
 * hidden tabs actually changes, so any cache-reading predicate stays reactive.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { notifyManager, type QueryCacheNotifyEvent } from '@tanstack/react-query';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { queryClient } from '../../lib/query-client';
import { hubModuleTabs, hubTabs, type HubTabEntry } from './hub-tabs';

/** A value-stable fingerprint of which tabs are hidden (`useSyncExternalStore` compares with `Object.is`). */
export function hiddenTabsKey(tabs: readonly HubTabEntry[]): string {
    return tabs.filter((t) => t.hidden).map((t) => t.id).join('|');
}

/**
 * Whether a cache event can change what a `visible` predicate reads: a query
 * appearing or leaving, or a dispatch that writes `state.data` (a fetch
 * landing, `setQueryData`, `setState`). Observer churn, fetch starts,
 * failures and invalidations leave the cached data alone, so they are ignored.
 */
export function changesCachedData(event: QueryCacheNotifyEvent): boolean {
    if (event.type === 'added' || event.type === 'removed') return true;
    return event.type === 'updated' && (event.action.type === 'success' || event.action.type === 'setState');
}

const noSubscription = (): (() => void) => () => {};

/** `hubTabs(...)`, re-evaluated whenever a query-cache data change flips any tab's visibility. */
export function useHubTabs(mod: HubModule | undefined, ctx: HubCtx, showResources: boolean, hasPosts: boolean): HubTabEntry[] {
    // Only a tab with a `visible` predicate can change with the cache; core's tabs never do.
    const reactive = hubModuleTabs(mod).some((t) => t.visible !== undefined);
    // A `visible` predicate is not a hook, so the only client it can read is
    // the app singleton — listen on that same client (not the context one), so
    // a nested provider can never leave the frame watching a different cache.
    const cache = queryClient.getQueryCache();
    // Batched like TanStack's own `useIsFetching`: a cache event raised while
    // another component renders (a query being built) must not update this one mid-render.
    const subscribe = useCallback((onChange: () => void) => {
        if (!reactive) return noSubscription();
        const notify = notifyManager.batchCalls(onChange);
        return cache.subscribe((event) => { if (changesCachedData(event)) notify(); });
    }, [cache, reactive]);
    // React calls `snapshot` during this render; keep that evaluation and return
    // it, so the list is built once per render and matches the snapshot it was compared by.
    let rendered: HubTabEntry[] | undefined;
    const snapshot = (): string => {
        const tabs = hubTabs(mod, ctx, showResources, hasPosts);
        rendered ??= tabs;
        return hiddenTabsKey(tabs);
    };
    useSyncExternalStore(subscribe, snapshot, snapshot);
    return rendered ?? hubTabs(mod, ctx, showResources, hasPosts);
}
