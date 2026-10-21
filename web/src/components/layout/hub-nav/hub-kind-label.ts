/** ROK-1875 D5 — the short label each hub kind reads as (nav rows, directory cards, the kind filter). */
import type { GuildKind } from '@raid-ledger/contract';

export const HUB_KIND_LABEL: Record<GuildKind, string> = {
    game_server: 'Server',
    game_community: 'Community',
    wow_guild: 'Guild',
};
