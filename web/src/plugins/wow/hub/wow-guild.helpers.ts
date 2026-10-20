/**
 * ROK-1785/ROK-1830 — pure WoW-guild helpers for the hub's rank groups, realm
 * labels and editor delegation. The tab frame moved to
 * `web/src/components/hub/hub-tabs.ts` (core).
 */
import type { CharacterRole, GuildEditor, GuildMemberRow, GuildPage, GuildRankGroup } from '@raid-ledger/contract';

/** Role label + the existing role colour class (`web/src/index.css` `.role-*`). */
export const ROLE_META: Record<CharacterRole, { label: string; cls: string }> = {
    tank: { label: 'Tank', cls: 'role-tank' },
    healer: { label: 'Heal', cls: 'role-healer' },
    dps: { label: 'DPS', cls: 'role-dps' },
};

export const ROLE_ORDER: readonly CharacterRole[] = ['tank', 'healer', 'dps'];

export function rankLabel(group: Pick<GuildRankGroup, 'rankIndex' | 'rankName'>): string {
    if (group.rankName) return group.rankName;
    return group.rankIndex === null ? 'Unranked' : `Rank ${group.rankIndex}`;
}

/** The realm to show: the addon-reported name, else the prettified slug. */
export function guildRealm(guild: { realmName: string | null; realmSlug: string | null }): string | null {
    return guild.realmName ?? realmLabel(guild.realmSlug);
}

export function realmLabel(realmSlug: string | null): string | null {
    if (!realmSlug) return null;
    return realmSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Members staff may delegate to: everyone, the Guild Master included (rank 0 is not implicit). */
export function delegableMembers(page: GuildPage): GuildMemberRow[] {
    return page.ranks.flatMap((r) => r.members);
}

/**
 * True once a rank-0 (Guild Master) member holds a member grant. Rank grants are
 * inactive (ROK-1794 "explicit grants only"): one covering rank 0 gives the GM
 * nothing, so it does not count.
 */
export function gmIsEditor(page: GuildPage, editors: readonly GuildEditor[]): boolean {
    const gmIds = new Set(page.ranks.filter((r) => r.rankIndex === 0).flatMap((r) => r.members.map((m) => m.memberId)));
    return editors.some((e) => e.kind === 'member' && e.guildMemberId !== null && gmIds.has(e.guildMemberId));
}
