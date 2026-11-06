import { z } from 'zod';
import { CompanionTimestampSchema } from './companion-common.schema.js';

// ============================================================
// Companion dev bridge v1 — `bg3Catalogue` block of GET /dev/v1/collectors
// (ROK-2081, ruling 6): the state of the companion's BG3 game-data catalogue.
// A separate file so the endpoints schema imports it without a cycle.
// ============================================================

const Count = z.number().int().min(0).max(100_000_000);

/** Catalogue lifecycle. Closed: a new value is breaking (new `vN/`). */
export const DevBridgeBg3CatalogueStateSchema = z.enum(['absent', 'indexing', 'ready', 'failed']);

/**
 * Why the catalogue is `absent` (install discovery) or `failed` (build).
 * absent: `no-steam`, `no-bg3-library`, `no-app-manifest`, `no-data-dir`, `unsupported-store`, `other`;
 * failed: `timeout`, `too-large`, `pak-error`, `parse-error`, `install-changed`, `cache-error`, `other`.
 * `other` is the catch-all of both lists: an error kind the companion adds later maps to it, so a
 * new companion-side kind is not a new value here. Adding a named value is still breaking.
 */
const ABSENT_NAMED = ['no-steam', 'no-bg3-library', 'no-app-manifest', 'no-data-dir', 'unsupported-store'] as const;
const FAILED_NAMED = ['timeout', 'too-large', 'pak-error', 'parse-error', 'install-changed', 'cache-error'] as const;
export const DEV_BRIDGE_BG3_CATALOGUE_ABSENT_REASONS = [...ABSENT_NAMED, 'other'] as const;
export const DEV_BRIDGE_BG3_CATALOGUE_FAILED_REASONS = [...FAILED_NAMED, 'other'] as const;
export const DevBridgeBg3CatalogueReasonSchema = z.enum([...ABSENT_NAMED, ...FAILED_NAMED, 'other']);
const REASONS_BY_STATE: Readonly<Record<string, ReadonlySet<string>>> = {
    absent: new Set(DEV_BRIDGE_BG3_CATALOGUE_ABSENT_REASONS),
    failed: new Set(DEV_BRIDGE_BG3_CATALOGUE_FAILED_REASONS),
};

export const DevBridgeBg3CatalogueCountsSchema = z
    .object({ items: Count, origins: Count, quests: Count, waypoints: Count, skipped: Count })
    .strict();

/** Name / rarity resolution of the latest lookup batch (or, on `bg3-save-catalogue`, of the whole save). */
const hitRateShape = { total: Count, resolvedName: Count, resolvedRarity: Count };
type HitRate = { total: number; resolvedName: number; resolvedRarity: number };

function checkHitRate(h: HitRate, ctx: z.RefinementCtx): void {
    for (const key of ['resolvedName', 'resolvedRarity'] as const) {
        if (h[key] > h.total) ctx.addIssue({ code: 'custom', path: [key], message: `${key} exceeds total` });
    }
}

export const DevBridgeBg3HitRateSchema = z.object(hitRateShape).strict().superRefine(checkHitRate);

/** `lastLookup`: the hit rate of the latest lookup batch, and when it ran. */
export const DevBridgeBg3LastLookupSchema = z
    .object({ ...hitRateShape, at: CompanionTimestampSchema })
    .strict()
    .superRefine(checkHitRate);

type Report = {
    state: z.output<typeof DevBridgeBg3CatalogueStateSchema>;
    reason: string | null;
    buildMs: number | null;
    builtAt: string | null;
    counts: unknown;
    lastLookup: unknown;
};

/**
 * `reason` iff absent/failed, from that state's list; `ready` carries buildMs + builtAt + counts;
 * `absent` (no install, so never a catalogue) carries none of buildMs/builtAt/counts/lastLookup.
 */
function checkReport(r: Report, ctx: z.RefinementCtx): void {
    const allowed = REASONS_BY_STATE[r.state];
    if ((allowed !== undefined) !== (r.reason !== null)) {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: `reason must be ${allowed !== undefined ? 'set' : 'null'} when state is ${r.state}` });
    } else if (allowed !== undefined && r.reason !== null && !allowed.has(r.reason)) {
        ctx.addIssue({ code: 'custom', path: ['reason'], message: `reason ${r.reason} does not belong to state ${r.state}` });
    }
    if (r.state === 'absent') {
        for (const key of ['buildMs', 'builtAt', 'counts', 'lastLookup'] as const) {
            if (r[key] !== null) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be null when state is absent` });
        }
    }
    if (r.state !== 'ready') return;
    for (const key of ['buildMs', 'builtAt', 'counts'] as const) {
        if (r[key] === null) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when state is ready` });
    }
}

/**
 * Optional `bg3Catalogue` block on GET /dev/v1/collectors (not on a collector
 * row). While `indexing` or `failed` the previous catalogue may still be served
 * (ruling 9), so `buildMs`/`builtAt`/`counts`/`lastLookup` may describe it;
 * `absent` has no catalogue, so all four are null.
 */
export const DevBridgeBg3CatalogueReportSchema = z
    .object({
        state: DevBridgeBg3CatalogueStateSchema,
        reason: DevBridgeBg3CatalogueReasonSchema.nullable(),
        buildMs: z.number().int().min(0).max(3_600_000).nullable(),
        builtAt: CompanionTimestampSchema.nullable(),
        counts: DevBridgeBg3CatalogueCountsSchema.nullable(),
        lastLookup: DevBridgeBg3LastLookupSchema.nullable(),
    })
    .strict()
    .superRefine(checkReport);

export type DevBridgeBg3CatalogueReport = z.output<typeof DevBridgeBg3CatalogueReportSchema>;
