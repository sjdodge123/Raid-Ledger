import { z } from 'zod';
import type { WowRegion } from './characters.schema.js';

// ============================================================
// WoW Instance Schemas (Dungeon/Raid browsing)
// ============================================================

/** Basic WoW dungeon/raid instance info */
export const WowInstanceSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    shortName: z.string().optional(),
    expansion: z.string(),
    minimumLevel: z.number().int().nullable().optional(),
    maximumLevel: z.number().int().nullable().optional(),
});

export type WowInstanceDto = z.infer<typeof WowInstanceSchema>;

/** Enriched instance with level requirements and player count */
export const WowInstanceDetailSchema = WowInstanceSchema.extend({
    minimumLevel: z.number().int().nullable(),
    maximumLevel: z.number().int().nullable().optional(),
    maxPlayers: z.number().int().nullable(),
    category: z.enum(['dungeon', 'raid']),
});

export type WowInstanceDetailDto = z.infer<typeof WowInstanceDetailSchema>;

/** Response for GET /blizzard/instances */
export const WowInstanceListResponseSchema = z.object({
    data: z.array(WowInstanceSchema),
});

export type WowInstanceListResponseDto = z.infer<typeof WowInstanceListResponseSchema>;

// ============================================================
// WoW: Forever identity (ROK-1721; moved here from characters.schema.ts by ROK-1733)
// ============================================================

/**
 * WoW: Forever is realmless — a character lives in a region and plays on a
 * ruleset. The ruleset is a mutable attribute (dead Hardcore characters can
 * move), NOT part of the identity; identity is region + full two-part name.
 */
export const WowForeverRulesetSchema = z.enum(['normal', 'pvp', 'roleplaying', 'hardcore']);
export type WowForeverRuleset = z.infer<typeof WowForeverRulesetSchema>;

/**
 * Rulesets a player can pick today. Hardcore opens after launch, so it is
 * stored-capable but not accepted on create/update until it is enabled here.
 */
export const WowForeverSelectableRulesetSchema = WowForeverRulesetSchema.exclude(['hardcore']);
export type WowForeverSelectableRuleset = z.infer<typeof WowForeverSelectableRulesetSchema>;
export const WOW_FOREVER_SELECTABLE_RULESETS = WowForeverSelectableRulesetSchema.options;

export const WOW_FOREVER_RULESET_LABELS: Record<WowForeverRuleset, string> = {
    normal: 'Normal',
    pvp: 'PvP',
    roleplaying: 'Roleplaying',
    hardcore: 'Hardcore',
};

export const WOW_FOREVER_DEFAULT_REGION: WowRegion = 'us';

/** One name part: letters only, 2–24 (tighten/loosen once Blizzard publishes the rules). */
export const WowForeverNamePartSchema = z.string().trim()
    .regex(/^\p{L}{2,24}$/u, 'Use 2–24 letters');

/** Full Forever name stored in `characters.name`: "First Second", one space. */
export const WowForeverNameSchema = z.string().trim().max(100)
    .regex(/^\p{L}{2,24} \p{L}{2,24}$/u, 'Enter a first and second name');

// ============================================================
// ROK-1717: runtime WoW: Forever namespace prefix + Armory flag
// ============================================================

/** Public capability flags the Add Character flow reads (no auth). */
export const BlizzardCapabilitiesSchema = z.object({
    armoryImport: z.object({ wow_forever: z.boolean() }),
});
export type BlizzardCapabilitiesDto = z.infer<typeof BlizzardCapabilitiesSchema>;

/** Blizzard namespace prefix without `static-`/`dynamic-`/`profile-` or the region, e.g. `classicforever`. */
export const WowForeverNamespacePrefixSchema = z.string().trim().regex(/^[a-z0-9]{2,32}$/, 'Lowercase letters and digits only (2-32)');

/** Admin PUT body for the Forever settings. */
export const WowForeverConfigSchema = z.object({
    namespacePrefix: WowForeverNamespacePrefixSchema,
    armoryImportEnabled: z.boolean(),
    /** ROK-1727: Wowhead item resolver kill switch. Omitted on PUT = unchanged; GET always sends it (unset ⇒ true). */
    wowheadResolverEnabled: z.boolean().optional(),
});
export type WowForeverConfigDto = z.infer<typeof WowForeverConfigSchema>;

/** Admin GET response: the effective config plus whether the prefix is the built-in default. */
export const WowForeverConfigResponseSchema = WowForeverConfigSchema.extend({
    namespacePrefixIsDefault: z.boolean(),
});
export type WowForeverConfigResponseDto = z.infer<typeof WowForeverConfigResponseSchema>;

// ============================================================
// ROK-1716: WoW: Forever namespace discovery probe
// ============================================================

export const ForeverProbeEndpointSchema = z.enum(['realm', 'connected-realm', 'playable-race', 'profile']);
export type ForeverProbeEndpoint = z.infer<typeof ForeverProbeEndpointSchema>;

/** One probed (prefix, region, endpoint) → HTTP status; null status = network error / timeout. */
export const ForeverProbeCellSchema = z.object({
    prefix: z.string(),
    region: z.string(),
    endpoint: ForeverProbeEndpointSchema,
    status: z.number().int().nullable(),
    error: z.string().optional(),
});
export type ForeverProbeCellDto = z.infer<typeof ForeverProbeCellSchema>;

export const ForeverProbeMatchSchema = z.object({ prefix: z.string(), region: z.string(), raceName: z.string() });
export type ForeverProbeMatchDto = z.infer<typeof ForeverProbeMatchSchema>;

export const ForeverProbeFoundSchema = z.object({ prefix: z.string(), at: z.string() });
export type ForeverProbeFoundDto = z.infer<typeof ForeverProbeFoundSchema>;

/** Latest probe run, as stored and as the admin panel shows it. */
export const ForeverProbeResultSchema = z.object({
    ranAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(['ok', 'skipped', 'error']),
    candidates: z.array(z.string()),
    cells: z.array(ForeverProbeCellSchema),
    matches: z.array(ForeverProbeMatchSchema),
    shapes: z.record(z.string(), z.unknown()),
    found: ForeverProbeFoundSchema.nullable(),
});
export type ForeverProbeResultDto = z.infer<typeof ForeverProbeResultSchema>;

/** GET response: null result = the probe has never run. */
export const ForeverProbeStateSchema = z.object({
    result: ForeverProbeResultSchema.nullable(),
    extraCandidates: z.array(z.string()),
    characterPath: z.string().nullable(),
});
export type ForeverProbeStateDto = z.infer<typeof ForeverProbeStateSchema>;

/** Admin PUT body: extra candidate prefixes + optional raw `<realmOrRuleset>/<name>` profile path. */
export const ForeverProbeConfigSchema = z.object({
    extraCandidates: z.array(WowForeverNamespacePrefixSchema).max(20),
    // A dot-only name (`.`/`..`) would resolve to another Blizzard path, so it is rejected.
    characterPath: z.string().trim().regex(/^[a-z0-9-]{1,64}\/(?!\.{1,2}$)[^/\s?#&]{1,64}$/i).nullable(),
});
export type ForeverProbeConfigDto = z.infer<typeof ForeverProbeConfigSchema>;
