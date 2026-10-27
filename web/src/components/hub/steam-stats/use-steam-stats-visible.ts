/**
 * ROK-1953 D10 — the Steam cards' `useVisible` probes, loaded eagerly by the
 * Core `register.ts`, so they carry only the light query layer. Achievements
 * shows iff the game is enabled AND has achievements; Playtime iff enabled.
 * A 404 (`null`) or a pending query hides both.
 */
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { useHubSteamStats } from './use-hub-steam-stats';

/** Achievement race: `available` and the game's schema has at least one achievement. */
export function useSteamAchievementsVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useHubSteamStats(page.guild.id);
    return data?.available === true && data.totalAchievements > 0;
}

/** Playtime: `available` (a game with no achievements still has playtime). */
export function useSteamPlaytimeVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useHubSteamStats(page.guild.id);
    return data?.available === true;
}
