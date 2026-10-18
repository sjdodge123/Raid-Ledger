/**
 * ROK-1830 — whether the WoW Resources section ("Recommended addons") has
 * anything in it. Core asks through `HubModSource.useVisible`, so the
 * addons query and the rule that reads it both live in this plugin; core never
 * touches `/plugins/wow/guilds/:id/addons`.
 *
 * Kept out of `guild/guild-addons.tsx` on purpose: `register-hub.ts` is a
 * boot-time import, and pulling the panel in here would undo its lazy chunk.
 */
import type { GuildAddonList } from '@raid-ledger/contract';
import { useGuildAddons } from '../../../components/hub/api/use-guild-content';

/** Pinned rows count too — they are shown to everyone, editable or not. */
export function wowAddonsVisible(list: GuildAddonList | undefined): boolean {
    return (list?.pinned.length ?? 0) + (list?.addons.length ?? 0) > 0;
}

export function useWowAddonsVisible(guildId: number): boolean {
    return wowAddonsVisible(useGuildAddons(guildId).data);
}
