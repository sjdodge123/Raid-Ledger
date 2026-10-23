/** ROK-1922 — pure bits of the Forever Role breakdown widget (kept out of `roles.register.ts`'s weight). */
import type { HubFactFreshness, WowRosterInsightsDto } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';

export type RoleBands = WowRosterInsightsDto['roles'];
export type RoleBandKey = keyof RoleBands;
export type BandRole = keyof RoleBands['dungeon'];

/** Display order of a band's roles: the three real roles, then the unset bucket. */
export const BAND_ROLES: readonly BandRole[] = ['tank', 'healer', 'dps', 'unknown'];

/** Past this age the freshness footer switches to the warning tone (plan §2.3). */
export const STALE_AFTER_MS = 14 * 86_400_000;

const PLURAL: Record<BandRole, string> = { tank: 'tanks', healer: 'healers', dps: 'DPS', unknown: 'members with no role' };
const SINGULAR: Record<BandRole, string> = { tank: 'tank', healer: 'healer', dps: 'DPS', unknown: 'member with no role' };
const SOURCE_LABEL: Record<HubFactFreshness['source'], string> = {
    addon: 'LedgerLink', blizzard: 'Blizzard', roster: 'the guild roster', manual: 'member entries',
};

/** True when at least one dungeon- or raid-ready member has a known role. */
export function hasKnownRoles(roles: RoleBands): boolean {
    return [roles.dungeon, roles.raid].some((b) => b.tank + b.healer + b.dps > 0);
}

/** "2 dungeon-ready tanks — open Members", the role link's accessible name. */
export function roleLinkLabel(band: RoleBandKey, role: BandRole, count: number): string {
    const noun = count === 1 ? SINGULAR[role] : PLURAL[role];
    return `${count} ${band}-ready ${noun} — open Members`;
}

/** "via LedgerLink · as of 3 days ago" plus whether it is past the stale line. */
export function freshnessLine(fresh: HubFactFreshness, now: number = Date.now()): { text: string; stale: boolean } {
    const via = `via ${SOURCE_LABEL[fresh.source]}`;
    if (fresh.asOf === null) return { text: via, stale: false };
    return { text: `${via} · as of ${syncedAgo(fresh.asOf, now)}`, stale: now - Date.parse(fresh.asOf) > STALE_AFTER_MS };
}
