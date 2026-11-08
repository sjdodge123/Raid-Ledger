import { z } from 'zod';
import {
    ADDON_MAILWORTHY_DAYS_MAX,
    ADDON_MAILWORTHY_RULES_MAX,
    AddonMailworthyDaySchema,
    AddonMailworthyRuleSchema,
} from './wow-addon-mailworthy.schema.js';

// ============================================================
// Guild contributions hub widget (ROK-2148) — read DTO for
// `GET /plugins/wow/guilds/:id/contributions` + the stored-jsonb schemas.
// Meter is per PLAYER (operator round 2): a linked character's alts roll
// up to the RL user; an unlinked character ranks on its own.
// ============================================================

/** Stored `guild_mailworthy_templates.rules` — re-parsed on read, never trusted raw. */
export const GuildMailworthyStoredRulesSchema = z
    .array(AddonMailworthyRuleSchema)
    .max(ADDON_MAILWORTHY_RULES_MAX);
export type GuildMailworthyStoredRules = z.infer<typeof GuildMailworthyStoredRulesSchema>;

/** Stored `guild_mailworthy_givers.days` — re-parsed on read, never trusted raw. */
export const GuildMailworthyStoredDaysSchema = z
    .array(AddonMailworthyDaySchema)
    .max(ADDON_MAILWORTHY_DAYS_MAX);
export type GuildMailworthyStoredDays = z.infer<typeof GuildMailworthyStoredDaysSchema>;

/** Crafting skill line id → English profession name (D7; ids UNVERIFIED U3 for Forever). */
export const WOW_CRAFTING_SKILL_LINES: Readonly<Record<number, string>> = Object.freeze({
    171: 'Alchemy', 164: 'Blacksmithing', 333: 'Enchanting', 202: 'Engineering',
    165: 'Leatherworking', 197: 'Tailoring', 185: 'Cooking', 129: 'First Aid',
});

/** Skill line id → practitioner noun for the "Guild Enchanter" label (round-2 ruling). */
const MASTER_NOUNS: Readonly<Record<number, string>> = Object.freeze({
    171: 'Alchemist', 164: 'Blacksmith', 333: 'Enchanter', 202: 'Engineer',
    165: 'Leatherworker', 197: 'Tailor', 185: 'Cook', 129: 'Medic',
});

/** Profession name for a skill line id; unknown → `Profession <id>`. */
export function wowCraftingProfessionName(skillLineId: number): string {
    return WOW_CRAFTING_SKILL_LINES[skillLineId] ?? `Profession ${skillLineId}`;
}

/** Master label, e.g. `Guild Enchanter`; unknown → `Guild Profession <id> master`. */
export function wowCraftingMasterTitle(skillLineId: number): string {
    const noun = MASTER_NOUNS[skillLineId];
    return noun ? `Guild ${noun}` : `Guild ${wowCraftingProfessionName(skillLineId)} master`;
}

const characterId = z.string().uuid().nullable();
const items = z.number().int().nonnegative();

/** One template rule resolved against the guild's latest roster (ruling 6). */
export const GuildContributionsMasterSchema = z.object({
    professionSkillLineId: z.number().int().positive(),
    /** `wowCraftingProfessionName(id)`. */
    profession: z.string(),
    /** `wowCraftingMasterTitle(id)`, e.g. `Guild Enchanter`. */
    title: z.string(),
    recipientName: z.string(),
    /** Linked RL character when the name resolves on the roster, else null. */
    characterId,
    /** false → render "not on roster". */
    onRoster: z.boolean(),
}).strict();
export type GuildContributionsMaster = z.infer<typeof GuildContributionsMasterSchema>;

/** One ranked PLAYER on the top-givers meter (alts rolled up when linked). */
export const GuildContributionsGiverSchema = z.object({
    /** 1-based position in the full ranking (also for a `you…` row below the top 10). */
    rank: z.number().int().positive(),
    /** RL user the characters roll up to; null = an unlinked character ranked alone. */
    userId: z.number().int().positive().nullable(),
    /** The name shown: the player's top-giving character in the window. */
    characterName: z.string(),
    characterId,
    /** Characters summed into this row (1 when unlinked). */
    characterCount: z.number().int().positive(),
    items,
    /** The viewer's own row ("You" pill). */
    isYou: z.boolean(),
}).strict();
export type GuildContributionsGiver = z.infer<typeof GuildContributionsGiverSchema>;

/** A guild member whose Mailworthy said hello in the last 60 days (ruling 4). */
export const GuildContributionsUserSchema = z.object({
    characterName: z.string(),
    characterId,
    lastSeenAt: z.string().datetime(),
}).strict();
export type GuildContributionsUser = z.infer<typeof GuildContributionsUserSchema>;

export const GuildContributionsTemplateSchema = z.object({
    rev: z.string().datetime(),
    authorName: z.string(),
    authorCharacterId: characterId,
}).strict();
export type GuildContributionsTemplate = z.infer<typeof GuildContributionsTemplateSchema>;

export const GuildContributionsGiversSchema = z.object({
    last30Days: z.array(GuildContributionsGiverSchema).max(10),
    allTime: z.array(GuildContributionsGiverSchema).max(10),
    /** Viewer's row when ranked OUTSIDE the top 10; null when inside or not giving. */
    youLast30Days: GuildContributionsGiverSchema.nullable(),
    youAllTime: GuildContributionsGiverSchema.nullable(),
    /** Whole guild (on-roster rows), for "N items given this month". */
    last30DaysTotal: items,
    allTimeTotal: items,
    /** min(counting_since) of on-roster rows. */
    countingSince: z.string().datetime().nullable(),
    /** max(as_of) — the freshness footer. */
    asOf: z.string().datetime().nullable(),
}).strict();
export type GuildContributionsGivers = z.infer<typeof GuildContributionsGiversSchema>;

/** `GET /plugins/wow/guilds/:id/contributions` — members + staff only (403 otherwise). */
export const GuildContributionsDtoSchema = z.object({
    template: GuildContributionsTemplateSchema.nullable(),
    masters: z.array(GuildContributionsMasterSchema).max(ADDON_MAILWORTHY_RULES_MAX),
    givers: GuildContributionsGiversSchema,
    users: z.array(GuildContributionsUserSchema).max(1000),
}).strict();
export type GuildContributionsDto = z.infer<typeof GuildContributionsDtoSchema>;
