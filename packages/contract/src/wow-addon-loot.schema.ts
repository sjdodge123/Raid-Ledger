import { z } from 'zod';
import { AddonGuidSchema } from './wow-addon-export.schema.js';

// ============================================================
// LedgerLink v2 `loot` section (ROK-2184)
//
// Loot HISTORY only — who received which item, when, and from which boss if
// the addon could attribute it. No DKP, no points, no roll values, no chat
// text (ROK-1790 ruling 5). Only exists inside a `!RL2!loot!…` token with
// payload `schema: 2`; a v1 token never carries it. Every object is
// `.strict()` like the v1 sections: an unknown key rejects the whole string.
// Spec: planning-artifacts/specs/ROK-2184.md (rulings Q4/Q5/Q9/Q10).
// ============================================================

/** Max `data.drops` entries in one `loot` token (spec D4). */
export const ADDON_LOOT_DROPS_MAX = 500;
/** `drops[].looterName` cap (UTF-16 units). */
export const ADDON_LOOT_LOOTER_NAME_MAX = 100;
/** `drops[].encounterName` cap. */
export const ADDON_LOOT_ENCOUNTER_NAME_MAX = 128;
/** `drops[].link` cap — the raw `|Hitem:…|h[…]|h` link. */
export const ADDON_LOOT_LINK_MAX = 512;
/** `drops[].quantity` ceiling (stack size received). */
export const ADDON_LOOT_QUANTITY_MAX = 1000;
/**
 * Server de-duplication bucket for `drops[].at` (ruling Q5): the key is
 * (guild, looterGuid ?? looterName, itemId, quantity, floor(at / 120),
 * instanceId). Two identical items to one looter inside one bucket collapse.
 */
export const ADDON_LOOT_DEDUP_BUCKET_SECONDS = 120;
/**
 * Boss attribution (ruling Q4, addon-side): the most recent successful
 * `ENCOUNTER_END` in the same instance ending ≤ 300 s before the drop.
 */
export const ADDON_LOOT_ATTRIBUTION_WINDOW_SECONDS = 300;
/** Rolling window the addon keeps and re-sends on every export (ruling Q9). */
export const ADDON_LOOT_WINDOW_DAYS = 30;
/** Default lowest item quality the addon records: 2 = uncommon (ruling Q9). */
export const ADDON_LOOT_DEFAULT_MIN_QUALITY = 2;

/** Postgres `int4` ceiling — every id lands in an `integer` column. */
const INT4_MAX = 2_147_483_647;
/** Unix seconds; ceiling 2100-01-01 so a millisecond value is rejected. */
const UNIX_SECONDS_MAX = 4_102_444_800;

const id = z.number().int().nonnegative().max(INT4_MAX);
const unixSeconds = z.number().int().positive().max(UNIX_SECONDS_MAX);
/** WoW item quality 0 (poor) – 7 (heirloom). */
const quality = z.number().int().min(0).max(7);

/**
 * `master` = master loot assigned it · `roll` = won a need/greed roll ·
 * `direct` = looted from the corpse / free-for-all / round-robin ·
 * `unknown` = the addon could not tell.
 */
export const AddonLootMethodSchema = z.enum(['master', 'roll', 'direct', 'unknown']);
export type AddonLootMethod = z.infer<typeof AddonLootMethodSchema>;

/** One received item. `encounterName` only travels with `encounterId`. */
export const AddonLootDropSchema = z.object({
    /** `GetServerTime()` when the loot line arrived. */
    at: unixSeconds,
    itemId: z.number().int().positive().max(INT4_MAX),
    /**
     * Raw link as received; the server keeps WoW escape sequences and strips
     * control characters. Omit when unavailable (never `''`).
     */
    link: z.string().min(1).max(ADDON_LOOT_LINK_MAX).optional(),
    quantity: z.number().int().min(1).max(ADDON_LOOT_QUANTITY_MAX),
    /** From the link colour / `GetItemInfo`; omit when unknown. */
    quality: quality.optional(),
    /** `Name-Realm` when the client gives a realm, else bare `Name`. */
    looterName: z.string().min(1).max(ADDON_LOOT_LOOTER_NAME_MAX),
    /** From the group roster; omit rather than guess. */
    looterGuid: AddonGuidSchema.optional(),
    method: AddonLootMethodSchema,
    /** `GetInstanceInfo()` id — same id space as v1 raid `pulls[].instanceId`. */
    instanceId: id.optional(),
    difficultyId: id.optional(),
    /** The boss the drop is attributed to (Q4); omit for trash / unknown. */
    encounterId: id.optional(),
    encounterName: z.string().min(1).max(ADDON_LOOT_ENCOUNTER_NAME_MAX).optional(),
}).strict().superRefine((drop, ctx) => {
    if (drop.encounterName !== undefined && drop.encounterId === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['encounterName'],
            message: 'encounterName requires encounterId',
        });
    }
});
export type AddonLootDrop = z.infer<typeof AddonLootDropSchema>;

/**
 * `windowStart`/`minQuality` say what an ABSENT drop means (ruling Q9): a
 * drop older than `windowStart` or below `minQuality` was not recorded, not
 * lost. `drops` is oldest first and may be `[]`.
 */
export const AddonLootDataSchema = z.object({
    windowStart: unixSeconds,
    /** `≥ windowStart`; normally `exportedAt`. */
    windowEnd: unixSeconds,
    minQuality: quality,
    drops: z.array(AddonLootDropSchema).max(ADDON_LOOT_DROPS_MAX),
}).strict().superRefine((data, ctx) => {
    if (data.windowEnd < data.windowStart) {
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'windowEnd before windowStart' });
    }
    data.drops.forEach((drop, i) => {
        if (drop.at < data.windowStart || drop.at > data.windowEnd) {
            ctx.addIssue({ code: 'custom', path: ['drops', i, 'at'], message: 'drop outside the export window' });
        }
    });
});
export type AddonLootData = z.infer<typeof AddonLootDataSchema>;

// `AddonLootImportSummarySchema` lives in `wow-addon-import.schema.ts` beside
// the other import summaries: importing it from here made a module cycle
// (export → import → loot → export).
