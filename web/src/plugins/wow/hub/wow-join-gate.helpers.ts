/**
 * ROK-2132 — copy and pure rules for the WoW: Forever join gate.
 * The roster syncs from Blizzard every 6 hours (`forever-guild-roster-sync`,
 * `wow-cron-registrar.ts`), not hourly, so the hint drops Ruling 5's
 * "refreshes every hour" sentence as the spec directs.
 */
import type { WowGuildJoinGateGuild } from '@raid-ledger/contract';

export const JOIN_GATE_LINE = 'This guild page is for members. Find your character on the roster to join.';
export const PICK_CHARACTER_LABEL = 'Pick my character';
export const IMPORT_ARMORY_LABEL = 'Import from Armory';
export const NOT_ON_ROSTER_LEAD = 'Already added your character?';
export const NOT_ON_ROSTER_BODY = "It isn't on this guild's roster yet — ask an officer.";
export const NOT_LINKED_WARNING = "Your character was added, but it isn't linked to this guild yet. Ask an officer to check the roster.";

/** `?claim=roster` — the directory card's "Claim your character to join" landing (Ruling 9). */
export const CLAIM_PARAM = 'claim';
export const CLAIM_ROSTER = 'roster';

/** "realm · REGION · WoW: Forever" (a guild without a realm skips it). */
export function joinGateMeta(guild: Pick<WowGuildJoinGateGuild, 'realmName' | 'region'>): string {
    return [guild.realmName, guild.region.toUpperCase(), 'WoW: Forever'].filter((p) => p !== null && p !== '').join(' · ');
}

export function memberCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'member' : 'members'}`;
}

/** Whether the viewer gained a character since `baseline` was taken (a claim or import landed). */
export function gainedCharacter(baseline: ReadonlySet<string> | null, current: readonly { id: string }[] | undefined): boolean {
    if (baseline === null || current === undefined) return false;
    return current.some((c) => !baseline.has(c.id));
}
