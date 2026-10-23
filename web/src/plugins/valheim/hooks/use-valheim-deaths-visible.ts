/**
 * ROK-1930 — the Deaths card's `useVisible` probe, kept out of the widget's lazy
 * chunk's imports on purpose: `register.ts` loads it eagerly, so it carries only
 * the query key and pulls the shape-locked fetcher in with a dynamic import
 * (app-entry budget). Same key as `useValheimDeaths`, so the card reuses the probe's data.
 */
import { useQuery } from '@tanstack/react-query';
import type { HubWidgetCtx } from '../../hub-game-widgets';

/** Query key for one server's death counts (`valheimArmoryKeys.all` + 'deaths'). */
export const valheimDeathsKey = (serverId: number) =>
    ['plugins', 'valheim', 'armory', 'deaths', serverId] as const;

/** The Overview card's `useVisible` probe: a server hub with at least one recorded death. */
export function useDeathsWidgetVisible(ctx: HubWidgetCtx): boolean {
    const serverId = ctx.page.server?.pelicanServerId ?? 0;
    const { data } = useQuery({
        queryKey: valheimDeathsKey(serverId),
        queryFn: async () => (await import('./use-valheim-deaths')).fetchValheimDeaths(serverId),
        enabled: serverId > 0,
        retry: false,
    });
    return serverId > 0 && (data?.players.length ?? 0) > 0;
}
