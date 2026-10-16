/**
 * Shared React Query keys for the viewer's per-game interest entry and their
 * muted-games list (ROK-1797). Both payloads are personalized
 * (`wantToPlay`, `notificationsMuted`, the viewer's mutes), so both keys end
 * in the viewer scope (ROK-1314 `useViewerCacheScope`): `logout()` only resets
 * `['auth','me']`, and a shared key would serve user A's mutes and bell state
 * to user B for the stale window.
 *
 * One builder for the heart (`use-want-to-play`) and the bell
 * (`use-game-notification-mute`): their optimistic writes must hit the SAME
 * cache entry. The viewer goes LAST so `['games','interest',gameId]` stays a
 * usable invalidation prefix.
 */
import type { useViewerCacheScope } from './use-auth';

export type ViewerScope = ReturnType<typeof useViewerCacheScope>;

/** The viewer's interest in one game (`GET /games/:id/interest`). */
export function gameInterestQueryKey(gameId: number | undefined, viewer: ViewerScope) {
    return ['games', 'interest', gameId, viewer] as const;
}

/** The viewer's muted-games list (`GET /notifications/game-mutes`). */
export function gameMutesQueryKey(viewer: ViewerScope) {
    return ['notifications', 'game-mutes', viewer] as const;
}
