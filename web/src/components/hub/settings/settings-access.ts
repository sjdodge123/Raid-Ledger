/**
 * Who gets the hub's settings entry. Most kinds keep the ROK-1830 rule (the
 * Leader / admin — `canManageEditors`); a community hub (ROK-1870) also opens
 * it to Officers, who edit the blurb and the Banned list. Staff resolve to
 * `leader` on a community page (D4). ROK-2192 (operator ruling 2026-11-13):
 * the linked guild's rank-0 member (`viewer.isGuildMaster`, the GUID-linked
 * GM — the api's `holdsTopRank`, as for recruitment, ROK-1789 Q-A6) opens it
 * too, but only where the hub module says a GM has a row to write
 * (`HubModule.topRankOpensSettings` — WoW: Forever hubs); the sheet still
 * shows them only the non-Leader rows.
 *
 * Intentional, pending an operator question (ROK-2192 review m4): a delegated
 * editor (`canEdit` without `canManageEditors`) does NOT open the sheet, even
 * though the api admits them on the Blizzard roster writes. Do not widen this
 * without that ruling.
 */
import type { GuildPage, GuildViewerAccess } from '@raid-ledger/contract';
import type { HubModule } from '../../../plugins/hub-module';

/** `true` when the viewer should see the settings trigger; `mod` is the hub kind's module, if its plugin is on. */
export function canOpenHubSettings(page: GuildPage, mod?: Pick<HubModule, 'topRankOpensSettings'>): boolean {
    if (page.community !== undefined) return page.viewer.role === 'leader' || page.viewer.role === 'officer';
    return page.viewer.canManageEditors || (page.viewer.isGuildMaster === true && mod?.topRankOpensSettings?.(page) === true);
}

/**
 * ROK-2192: `true` when the viewer may change the settings a GM is allowed
 * (the Blizzard roster slug / "Sync now") — an editor (`canEdit`) or the
 * linked guild's rank-0 GM. Mirrors the api's `GuildEditorOrTopRankGuard`.
 */
export function canWriteHubSettings(viewer: GuildViewerAccess): boolean {
    return viewer.canEdit || viewer.isGuildMaster === true;
}

/**
 * `true` when the viewer may use the Discord channel picker — the api's
 * `canManageDiscord`: the Leader / staff (`canManageEditors`; staff resolve to
 * `leader` on a community page). A community Officer opens settings (blurb,
 * Banned list) but never the picker, whose routes are Leader-only.
 */
export function canUseHubChannelPicker(page: GuildPage): boolean {
    return page.viewer.canManageEditors;
}
