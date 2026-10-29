/**
 * ROK-1830 — the WoW guild's hero note: the "Last imported from LedgerLink"
 * line under the next-raid chip. Pure, so it lives beside the pills rather
 * than in them (`react-refresh/only-export-components`).
 */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';

export function wowHeroNote({ page }: HubCtx): string | null {
    const at = page.guild.lastSnapshotAt;
    if (!at) return null;
    const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return page.importedBy ? `Last imported from LedgerLink ${when} by ${page.importedBy}` : `Last imported from LedgerLink ${when}`;
}

/** ROK-1815 — the two factions that get a colour; anything else stays a neutral pill. */
export type FactionKey = 'alliance' | 'horde';

/** Sources disagree on casing (LedgerLink `Alliance`, Blizzard `alliance`), so normalise. */
export function factionKey(faction: string | null): FactionKey | null {
    const key = faction?.trim().toLowerCase();
    return key === 'alliance' || key === 'horde' ? key : null;
}

export const FACTION_LABEL: Record<FactionKey, string> = { alliance: 'Alliance', horde: 'Horde' };

export type HeroRoleBadge = 'Guild Master' | 'Editor' | 'Member';

/**
 * ROK-1815 — the viewer's "Your role" chips, from the access model only.
 * Precedence: when GM and Editor both apply BOTH chips show (GM first) — rank 0
 * grants nothing (`GM_RANK_IMPLIES_EDIT = false`), so the two facts are
 * independent and hiding either would misstate the viewer's rights. An
 * admin/operator who is not a member is in the `canEdit` set, so reads "Editor"
 * (operator ruling 2026-10-16). "Member" only when neither applies; a visitor
 * gets nothing.
 */
export function heroRoleBadges(viewer: GuildPage['viewer']): HeroRoleBadge[] {
    const badges: HeroRoleBadge[] = [];
    if (viewer.isGuildMaster === true) badges.push('Guild Master');
    if (viewer.canEdit) badges.push('Editor');
    if (badges.length === 0 && viewer.role !== 'visitor') badges.push('Member');
    return badges;
}
