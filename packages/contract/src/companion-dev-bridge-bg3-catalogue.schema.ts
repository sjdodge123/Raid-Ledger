import { z } from 'zod';
import { BG3_PARTY_MAX } from './companion-bg3-save.schema.js';
import { companionDisplayTextSchema } from './companion-common.schema.js';
import { DevBridgeBg3CatalogueStateSchema, DevBridgeBg3HitRateSchema } from './companion-dev-bridge-bg3-catalogue-report.schema.js';
import { checkUniqueBy } from './companion-dev-bridge-bg3-redaction.js';
import {
    BG3_EQUIPMENT_SLOTS,
    devBridgeBg3BodyChecks,
    devBridgeBg3Ident,
    DevBridgeBg3EquipmentSlotSchema,
    DevBridgeBg3SaveRefSchema,
    DevBridgeBg3StatsIdSchema,
} from './companion-dev-bridge-bg3.schema.js';
import { devBridgeMaxBytes } from './companion-dev-bridge.schema.js';
import { DevBridgeRelativePathSchema } from './companion-dev-bridge-endpoints.schema.js';

// ============================================================
// Companion dev bridge v1 — BG3 game-data catalogue (ROK-2081, ruling 6).
// (`bg3Catalogue` on GET /dev/v1/collectors: companion-dev-bridge-bg3-catalogue-report.schema.ts)
// GET /dev/v1/bg3/install                     → `bg3-install`
// GET /dev/v1/bg3/saves/<saveRef>/catalogue   → `bg3-save-catalogue`
// Game-data names (items) ARE allowed on the LAN bridge (ruling 7); custom
// character names never. No absolute path: pak `rel` is relative to `Data/`.
// Both bodies get the BG3 body-wide GUID / 10+ digit guard.
// ============================================================

/**
 * Cursor of both catalogue bodies: `p<page>_(paks|party)_<offset>`, e.g. `p2_paks_3`. Never a file or folder name.
 * `paks` (bg3-install): `<offset>` = how many matched entries were already returned, counted flat across every
 * pak in pak order (one pak's entries can span pages). `party` (bg3-save-catalogue): party rows already returned.
 */
export const DevBridgeBg3CatalogueCursorSchema = z.string().regex(/^p[1-9][0-9]{0,3}_(paks|party)_[0-9]{1,6}$/);
const Next = DevBridgeBg3CatalogueCursorSchema.nullable();

/** LSPK compression method of one entry. Closed: a new value is breaking. */
export const DevBridgeBg3PakMethodSchema = z.enum(['none', 'zlib', 'lz4', 'zstd', 'unknown']);

/** One matched pak entry: its path inside the pak (game data), sizes and the archive part holding it. */
export const DevBridgeBg3PakEntrySchema = z
    .object({
        name: DevBridgeRelativePathSchema.max(256),
        sizeOnDisk: z.number().int().min(0).max(4_294_967_295),
        size: z.number().int().min(0).max(4_294_967_295),
        method: DevBridgeBg3PakMethodSchema,
        part: z.number().int().min(0).max(15),
    })
    .strict();

/** One pak, `rel` relative to the install's `Data/` folder (e.g. `Localization/English.pak`) — never absolute. */
export const DevBridgeBg3PakSchema = z
    .object({
        rel: DevBridgeRelativePathSchema.max(256).regex(/\.pak$/),
        parts: z.number().int().min(1).max(16),
        entriesMatched: z.array(DevBridgeBg3PakEntrySchema).max(96),
    })
    .strict()
    .superRefine((pak, ctx) => {
        pak.entriesMatched.forEach((e, i) => {
            if (e.part >= pak.parts) ctx.addIssue({ code: 'custom', path: ['entriesMatched', i, 'part'], message: `part must be less than parts (${pak.parts})` });
        });
    });

/** Which store the install came from (`mac-app-store` is a store, not a platform); null iff none was found. */
export const DevBridgeBg3StoreSchema = z.enum(['steam', 'gog', 'epic', 'mac-app-store', 'unknown']);

/**
 * GET /dev/v1/bg3/install?cursor= — paged by pak: every page repeats `found` +
 * `store`; a pak whose `entriesMatched` span pages repeats its head (`rel`,
 * `parts`) with the next slice (clients merge by `rel`). `found: false` ⇒ no paks;
 * `store` is null iff `found` is false.
 */
export const DevBridgeBg3InstallSchema = z
    .object({
        found: z.boolean(),
        store: DevBridgeBg3StoreSchema.nullable(),
        paks: z.array(DevBridgeBg3PakSchema).max(64),
        next: Next,
    })
    .strict()
    .superRefine((body, ctx) => {
        if (!body.found && body.paks.length > 0) ctx.addIssue({ code: 'custom', path: ['paks'], message: 'paks must be empty when found is false' });
        if (body.found !== (body.store !== null)) ctx.addIssue({ code: 'custom', path: ['store'], message: `store must be ${body.found ? 'set' : 'null'} when found is ${String(body.found)}` });
        checkUniqueBy(body.paks, 'paks', 'rel', (p) => p.rel, ctx);
        devBridgeBg3BodyChecks(body, ctx);
    });

/** One equipped item, resolved: `name`/`rarity` null = a miss (modded or unknown id, or no catalogue). */
export const DevBridgeBg3CatalogueItemSchema = z
    .object({
        slot: DevBridgeBg3EquipmentSlotSchema,
        statsId: DevBridgeBg3StatsIdSchema.nullable(),
        name: companionDisplayTextSchema(128).nullable(),
        rarity: devBridgeBg3Ident(64).nullable(),
    })
    .strict();

/** Upper bound of one serialised `bg3-save-catalogue` party row (19 items at their caps fit, with a page head). */
export const DEV_BRIDGE_BG3_CATALOGUE_ROW_MAX_BYTES = 12_288;

/** One party member's equipped items, by the same 0-based party index as `bg3-save-structure`. */
export const DevBridgeBg3CatalogueRowSchema = z
    .object({ slot: z.number().int().min(0).max(BG3_PARTY_MAX - 1), items: z.array(DevBridgeBg3CatalogueItemSchema).max(BG3_EQUIPMENT_SLOTS.length) })
    .strict()
    .superRefine((row, ctx) => {
        checkUniqueBy(row.items, 'items', 'slot', (i) => i.slot, ctx);
        devBridgeMaxBytes(DEV_BRIDGE_BG3_CATALOGUE_ROW_MAX_BYTES, 'Catalogue row')(row, ctx);
    });

/**
 * GET /dev/v1/bg3/saves/<saveRef>/catalogue?cursor= — paged by party row: every
 * page repeats `saveRef`, `catalogueState` and `hitRate` (over the whole save).
 * `catalogueState` absent/failed ⇒ every name and rarity is null. Unknown saveRef → 404.
 */
export const DevBridgeBg3SaveCatalogueSchema = z
    .object({
        saveRef: DevBridgeBg3SaveRefSchema,
        catalogueState: DevBridgeBg3CatalogueStateSchema,
        hitRate: DevBridgeBg3HitRateSchema,
        party: z.array(DevBridgeBg3CatalogueRowSchema).max(BG3_PARTY_MAX),
        next: Next,
    })
    .strict()
    .superRefine((body, ctx) => {
        checkUniqueBy(body.party, 'party', 'slot', (r) => r.slot, ctx);
        if (body.catalogueState === 'absent' || body.catalogueState === 'failed') checkNoNames(body.party, ctx);
        devBridgeBg3BodyChecks(body, ctx);
    });

function checkNoNames(party: readonly z.output<typeof DevBridgeBg3CatalogueRowSchema>[], ctx: z.RefinementCtx): void {
    party.forEach((row, r) => row.items.forEach((item, i) => {
        for (const key of ['name', 'rarity'] as const) {
            if (item[key] !== null) ctx.addIssue({ code: 'custom', path: ['party', r, 'items', i, key], message: `${key} must be null without a catalogue` });
        }
    }));
}

export type DevBridgeBg3Install = z.output<typeof DevBridgeBg3InstallSchema>;
export type DevBridgeBg3SaveCatalogue = z.output<typeof DevBridgeBg3SaveCatalogueSchema>;
