/**
 * ROK-2212 — a suggested group's links, built ONLY from the planner's own URL
 * helpers (ROK-2216 `planner-url.ts`) so there is one link format: Schedule =
 * ROK-2215's Create Event pre-fill (claimed members invited), Open in planner
 * = the planner link with all five tokens (unclaimed `m<memberId>` included).
 */
import { SUGGESTED_GROUP_SIZE, type GuildPage, type SuggestedGroupDto } from '@raid-ledger/contract';
import { createEventUrl, shareUrl, toCharacterIds, type PlanToken } from '../dungeon-planner/planner-url';

/** Where a card sits among its dungeon's groups; set only when the dungeon shows more than one. */
export interface GroupOrdinal {
    n: number;
    of: number;
}

/** The card's accessible name: "Shadowfang Keep group", or "… group 2 of 7" so same-dungeon cards differ. */
export function groupLabel(group: SuggestedGroupDto, ordinal?: GroupOrdinal): string {
    const base = `${group.instance.name} group`;
    return ordinal === undefined ? base : `${base} ${ordinal.n} of ${ordinal.of}`;
}

/** The group's planner tokens in slot order (tank, healer, dps×3). */
export function groupTokens(group: SuggestedGroupDto): PlanToken[] {
    return group.members.flatMap((m): PlanToken[] => {
        if (m.characterId !== null) return [{ kind: 'character', characterId: m.characterId }];
        return m.memberId === null ? [] : [{ kind: 'member', memberId: m.memberId }];
    });
}

/** `/hubs/:id?d=<dungeon>&c=<5 tokens>#dungeon-planner` (relative). */
export function plannerHref(group: SuggestedGroupDto, guildId: number): string {
    return shareUrl('', guildId, { instanceId: group.instance.id, tokens: groupTokens(group) });
}

/** The claimed members' character ids — the only ones Create Event can invite. */
export function inviteCharacterIds(group: SuggestedGroupDto): string[] {
    return toCharacterIds(groupTokens(group));
}

/** `/events/new?…&contentInstanceIds=<dungeon>[&inviteCharacterIds=<claimed>]`. */
export function scheduleHref(group: SuggestedGroupDto, page: { guild: Pick<GuildPage['guild'], 'id' | 'gameId'> }): string {
    return createEventUrl({
        gameId: page.guild.gameId,
        guildId: page.guild.id,
        instanceIds: [group.instance.id],
        inviteCharacterIds: inviteCharacterIds(group),
    });
}

/** The muted line under Schedule: nothing when all five are invited (spec L11). */
export function inviteNote(invited: number): string | null {
    if (invited >= SUGGESTED_GROUP_SIZE) return null;
    return invited === 0 ? 'Invites no one yet' : `Invites ${invited} of ${SUGGESTED_GROUP_SIZE}`;
}

/** The distinct non-null owners — the poll's pre-filled members (unclaimed rows have no user). */
export function pollMemberUserIds(group: SuggestedGroupDto): number[] {
    const ids = group.members.flatMap((m) => (m.userId === null ? [] : [m.userId]));
    return [...new Set(ids)];
}

/** ROK-2256: a name per poll member — the first claimed character's name for each owner. */
export function pollMemberNames(group: SuggestedGroupDto): { id: number; username: string }[] {
    const names = new Map<number, string>();
    for (const m of group.members) {
        if (m.userId !== null && !names.has(m.userId)) names.set(m.userId, m.name);
    }
    return [...names].map(([id, username]) => ({ id, username }));
}

/** Highest and lowest member level. */
export function memberLevelRange(group: SuggestedGroupDto): { low: number; high: number } {
    const levels = group.members.map((m) => m.level);
    return { low: Math.min(...levels), high: Math.max(...levels) };
}
