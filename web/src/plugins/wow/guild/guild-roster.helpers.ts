/**
 * ROK-1785 — pure helpers for the guild page roster, tabs and hero.
 */
import type { CharacterRole, GuildEditor, GuildMemberRow, GuildPage, GuildRankGroup } from '@raid-ledger/contract';

/** Role label + the existing role colour class (`web/src/index.css` `.role-*`). */
export const ROLE_META: Record<CharacterRole, { label: string; cls: string }> = {
    tank: { label: 'Tank', cls: 'role-tank' },
    healer: { label: 'Heal', cls: 'role-healer' },
    dps: { label: 'DPS', cls: 'role-dps' },
};

export const ROLE_ORDER: readonly CharacterRole[] = ['tank', 'healer', 'dps'];

/**
 * Every tab the approved prototype has. S1 shows Overview + Roster, S3 (ROK-1787) adds Raids;
 * the rest stay hidden until the story that fills them ships (spec Q3).
 */
export const GUILD_TABS = [
    { id: 'overview', label: 'Overview', hidden: false },
    { id: 'roster', label: 'Roster', hidden: false },
    { id: 'raids', label: 'Raids', hidden: false },
    { id: 'progression', label: 'Progression', hidden: true },
    { id: 'loot', label: 'Loot', hidden: true },
    { id: 'resources', label: 'Resources', hidden: true },
] as const;

export type GuildTabId = (typeof GUILD_TABS)[number]['id'];

export const VISIBLE_TAB_IDS: readonly string[] = GUILD_TABS.filter((t) => !t.hidden).map((t) => t.id);

export function tabLabel(id: string): string {
    return GUILD_TABS.find((t) => t.id === id)?.label ?? 'Overview';
}

export function rankLabel(group: Pick<GuildRankGroup, 'rankIndex' | 'rankName'>): string {
    if (group.rankName) return group.rankName;
    return group.rankIndex === null ? 'Unranked' : `Rank ${group.rankIndex}`;
}

/** Up to two initials for the crest placeholder ("Iron Vanguard" → "IV"). */
export function crestInitials(name: string): string {
    const letters = name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase());
    return letters.slice(0, 2).join('') || '?';
}

/** `area-52` → `Area 52`. */
/** The realm to show: the addon-reported name, else the prettified slug. */
export function guildRealm(guild: { realmName: string | null; realmSlug: string | null }): string | null {
    return guild.realmName ?? realmLabel(guild.realmSlug);
}

export function realmLabel(realmSlug: string | null): string | null {
    if (!realmSlug) return null;
    return realmSlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Ranks staff may delegate to: every non-GM rank (rank grants start at 1; grant the GM as a member). */
export function delegableRanks(page: GuildPage): { rankIndex: number; name: string }[] {
    return page.ranks.flatMap((r) => (r.rankIndex !== null && r.rankIndex > 0 ? [{ rankIndex: r.rankIndex, name: rankLabel(r) }] : []));
}

/** Members staff may delegate to: everyone, the Guild Master included (rank 0 is not implicit). */
export function delegableMembers(page: GuildPage): GuildMemberRow[] {
    return page.ranks.flatMap((r) => r.members);
}

/** True once a rank-0 (Guild Master) member holds a grant — directly, or via a rank grant covering rank 0. */
export function gmIsEditor(page: GuildPage, editors: readonly GuildEditor[]): boolean {
    const gmIds = new Set(page.ranks.filter((r) => r.rankIndex === 0).flatMap((r) => r.members.map((m) => m.memberId)));
    return editors.some((e) => (e.kind === 'rank' ? e.rankIndex === 0 : e.guildMemberId !== null && gmIds.has(e.guildMemberId)));
}
