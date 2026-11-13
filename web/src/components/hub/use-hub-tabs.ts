/**
 * ROK-1790 — the hub frame's tab list, kept live. A tab's `visible(ctx)` is a
 * plain predicate (not a hook), so one that reads the query cache — the WoW
 * Crafters tab peeks at roster insights another widget fetched — would only
 * be re-evaluated when something else re-rendered the frame. This hook
 * subscribes to the QueryCache and re-renders the frame only when the set of
 * hidden tabs actually changes, so any cache-reading predicate stays reactive.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import type { HubCtx, HubModule } from '../../plugins/hub-module';
import { hubTabs, type HubTabEntry } from './hub-tabs';

/** A value-stable fingerprint of which tabs are hidden (`useSyncExternalStore` compares with `Object.is`). */
export function hiddenTabsKey(tabs: readonly HubTabEntry[]): string {
    return tabs.filter((t) => t.hidden).map((t) => t.id).join('|');
}

/** `hubTabs(...)`, re-evaluated whenever a query-cache change flips any tab's visibility. */
export function useHubTabs(mod: HubModule | undefined, ctx: HubCtx, showResources: boolean, hasPosts: boolean): HubTabEntry[] {
    const cache = useQueryClient().getQueryCache();
    // Batched like TanStack's own `useIsFetching`: a cache event raised while
    // another component renders (a query being built) must not update this one mid-render.
    const subscribe = useCallback((onChange: () => void) => cache.subscribe(notifyManager.batchCalls(onChange)), [cache]);
    const snapshot = (): string => hiddenTabsKey(hubTabs(mod, ctx, showResources, hasPosts));
    useSyncExternalStore(subscribe, snapshot, snapshot);
    return hubTabs(mod, ctx, showResources, hasPosts);
}
