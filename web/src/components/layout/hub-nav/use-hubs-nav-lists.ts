/**
 * ROK-2152: what both Hubs nav shells (the header menu, the phone sheet) draw —
 * the viewer's hubs, the popular hubs, and whether to show the menu / sheet at
 * all or the plain `/hubs` link. One rule for both shells (§4.14).
 */
import type { HubDirectoryEntry, MyGuild } from '@raid-ledger/contract';
import { useMyGuildsQuery } from './my-hubs-queries';
import { usePopularHubs } from './popular-hubs-queries';

export interface HubsNavLists { hubs: MyGuild[]; popular: HubDirectoryEntry[]; showMenu: boolean }

/**
 * ROK-1875 D1 + ROK-2152 Q1: the menu / sheet once the viewer has a hub, or once
 * `/guilds/mine` has settled and there is a popular hub to suggest. Otherwise the
 * plain `/hubs` link, so the item goes link → menu only, never menu → link.
 */
export function useHubsNavLists(): HubsNavLists {
    const mine = useMyGuildsQuery();
    const hubs = mine.data?.guilds ?? [];
    const popular = usePopularHubs(hubs).hubs;
    const mineSettled = mine.isSuccess || mine.isError;
    return { hubs, popular, showMenu: hubs.length > 0 || (mineSettled && popular.length > 0) };
}
