import { z } from 'zod';

// ============================================================
// LedgerLink v1 `char` → `data.mailworthy` (ROK-2148, additive)
//
// What the Mailworthy addon knows about the exporter's guild, copied 1:1 by
// LedgerLink from `MailworthyAPI.v1.GetGuildExport()`: the guild template
// (profession → master), Mailworthy peers, and guild-rule item counts per
// character of the exporter's account. EVERY object is `.strict()` — a
// per-unit `cap` (never sent) rejects the whole string, like any unknown key.
// Absent block / template / peers / givers = no opinion; nothing is cleared.
// ============================================================

/** Mailworthy `Comms.MAX_NAME` — longest character name it holds. */
export const ADDON_MAILWORTHY_NAME_MAX = 48;
/** One rule per crafting profession. */
export const ADDON_MAILWORTHY_RULES_MAX = 8;
/** In-game guild member cap. */
export const ADDON_MAILWORTHY_PEERS_MAX = 1000;
/** Characters per account. */
export const ADDON_MAILWORTHY_GIVERS_MAX = 50;
/** 30-day window + clock slack. */
export const ADDON_MAILWORTHY_DAYS_MAX = 35;

/** Postgres `int4` ceiling (same as `wow-addon-export.schema.ts`). */
const INT4_MAX = 2_147_483_647;
/** Unix seconds; ceiling 2100-01-01 so a millisecond value is rejected. */
const UNIX_SECONDS_MAX = 4_102_444_800;
/** `floor(UNIX_SECONDS_MAX / 86400)` — last UTC day number accepted. */
const DAY_MAX = 47_482;

const count = z.number().int().nonnegative().max(INT4_MAX);
const unixSeconds = z.number().int().positive().max(UNIX_SECONDS_MAX);
const mwName = z.string().min(1).max(ADDON_MAILWORTHY_NAME_MAX);

/** One template rule: skill line → recipient. No `cap` key exists. */
export const AddonMailworthyRuleSchema = z.object({
    professionSkillLineId: z.number().int().positive().max(INT4_MAX),
    recipientName: mwName,
}).strict();
export type AddonMailworthyRule = z.infer<typeof AddonMailworthyRuleSchema>;

/** The guild template as the exporter's Mailworthy holds it. */
export const AddonMailworthyTemplateSchema = z.object({
    /** Author's `GetServerTime()` at publish — the template identity. */
    rev: unixSeconds,
    /** Publishing character (rank 0–1 in game). */
    author: mwName,
    rules: z.array(AddonMailworthyRuleSchema).max(ADDON_MAILWORTHY_RULES_MAX),
}).strict();
export type AddonMailworthyTemplate = z.infer<typeof AddonMailworthyTemplateSchema>;

/** A guild member whose Mailworthy said hello (≤ 60 days). */
export const AddonMailworthyPeerSchema = z.object({
    name: mwName,
    lastSeenAt: unixSeconds,
}).strict();
export type AddonMailworthyPeer = z.infer<typeof AddonMailworthyPeerSchema>;

/** Guild-rule item units sent on one UTC day (`floor(serverTime / 86400)`). */
export const AddonMailworthyDaySchema = z.object({
    day: z.number().int().nonnegative().max(DAY_MAX),
    items: count,
}).strict();
export type AddonMailworthyDay = z.infer<typeof AddonMailworthyDaySchema>;

/** One SENDING character of the exporter's account. */
export const AddonMailworthyGiverSchema = z.object({
    characterName: mwName,
    /** Guild-rule item units since `countingSince`. */
    itemsAllTime: count,
    countingSince: unixSeconds,
    /** Non-zero days in the last 35, ascending. */
    days: z.array(AddonMailworthyDaySchema).max(ADDON_MAILWORTHY_DAYS_MAX),
}).strict();
export type AddonMailworthyGiver = z.infer<typeof AddonMailworthyGiverSchema>;

/** `char` `data.mailworthy` — optional, additive (ROK-2148). */
export const AddonMailworthySchema = z.object({
    /** Mailworthy `GetServerTime()` at the API call. */
    generatedAt: unixSeconds,
    template: AddonMailworthyTemplateSchema.optional(),
    peers: z.array(AddonMailworthyPeerSchema).max(ADDON_MAILWORTHY_PEERS_MAX).optional(),
    givers: z.array(AddonMailworthyGiverSchema).max(ADDON_MAILWORTHY_GIVERS_MAX).optional(),
}).strict();
export type AddonMailworthy = z.infer<typeof AddonMailworthySchema>;
