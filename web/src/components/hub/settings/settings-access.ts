/**
 * Who gets the hub's settings entry. Most kinds keep the ROK-1830 rule (the
 * Leader / admin — `canManageEditors`); a community hub (ROK-1870) also opens
 * it to Officers, who edit the blurb and the Banned list. Staff resolve to
 * `leader` on a community page (D4).
 */
import type { GuildPage } from '@raid-ledger/contract';

/** `true` when the viewer should see the settings trigger. */
export function canOpenHubSettings(page: GuildPage): boolean {
    if (page.community !== undefined) return page.viewer.role === 'leader' || page.viewer.role === 'officer';
    return page.viewer.canManageEditors;
}
