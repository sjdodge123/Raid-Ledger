/**
 * ROK-1876 — the Quick Play tab's loading skeleton (design-system §4.5). The
 * tab shows it while its query is pending and the lazy shell
 * (`quick-play-tab-lazy.tsx`) while the chunk loads, so the two waits read as
 * one. Its own file: a component module may export only components.
 */
export const QUICK_PLAY_LOADING = (
    <div aria-busy="true" className="h-24 animate-pulse rounded-lg border border-edge bg-surface" data-testid="server-hub-quick-play-loading" />
);
