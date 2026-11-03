import { z } from 'zod';
import { CompanionTimestampSchema } from './companion-common.schema.js';
import {
    DEV_BRIDGE_PAGE_MAX_BYTES,
    DEV_BRIDGE_RESULT_ITEM_MAX_BYTES,
    DevBridgeCallStatusSchema,
    DevBridgeFlavorSchema,
    DevBridgeNextSchema,
    DevBridgeProbeValueSchema,
    devBridgeJsonBytes,
    devBridgeMaxBytes,
} from './companion-dev-bridge.schema.js';

// ============================================================
// Companion dev bridge v1 — LedgerLink dev snapshot (ROK-2072).
// With `/rl dev on`, LedgerLink writes one snapshot JSON string per
// character into `LedgerLinkDB.dev.snapshots[<guid>]` on every
// PLAYER_LOGOUT; rl-companion validates it (`ledgerlink-snapshot`), caches
// latest + 7 days locally and serves it at /dev/v1/ledgerlink/snapshot
// (`ledgerlink-snapshot-page`) and /snapshot/history
// (`ledgerlink-snapshot-history`). Never uploaded to Raid Ledger.
// The snapshot carries no name, realm, guild or GUID (D3/D4).
// ============================================================

/** `snapshotVersion` of the snapshot body. */
export const DEV_BRIDGE_SNAPSHOT_VERSION = 1;

/** A whole snapshot, serialised, stays at or under this. */
export const DEV_BRIDGE_SNAPSHOT_MAX_BYTES = 49_152;

/** The snapshot minus its `calls` / `apis` / `sections` arrays (the "head"), serialised, stays at or under this. */
export const DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES = 4_096;

/** A player GUID anywhere in a snapshot string (or table key) is a privacy bug (D3). */
const PLAYER_GUID_RE = /Player-\d{1,5}-[0-9A-Fa-f]{8}/;

/** 1–3 dot-separated Lua identifiers, e.g. `C_GameRules.IsGameRuleActive`, `Enum.GameRule`. */
const ApiPathSchema = z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/)
    .max(96);

/** What Lua `type(x)` returns. */
export const LedgerLinkSnapshotLuaTypeSchema = z.enum([
    'nil', 'function', 'table', 'string', 'number', 'boolean', 'userdata', 'thread',
]);

const SectionIdSchema = z.string().regex(/^S[0-9]{1,2}$/);
const SnapshotText = (max: number) => z.string().max(max);

/** `GetBuildInfo()` + the addon's own TOC interface, locale and raw region. */
export const LedgerLinkSnapshotClientSchema = z
    .object({
        version: SnapshotText(32),
        build: SnapshotText(16),
        buildDate: SnapshotText(32),
        interface: z.number().int().min(0).max(9_999_999),
        tocInterface: z.number().int().min(0).max(9_999_999).nullable(),
        locale: SnapshotText(8),
        region: z.number().int().nullable(),
    })
    .strict();

/** One `Enum.GameRule` member, discovered by `pairs()` — never assumed (D8). */
export const LedgerLinkSnapshotGameRuleSchema = z
    .object({
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
        value: z.union([z.number(), z.string().max(64)]),
        active: z.boolean().nullable(),
        error: SnapshotText(256).optional(),
    })
    .strict();

export const LedgerLinkSnapshotRulesetSchema = z
    .object({
        isGameRuleActive: LedgerLinkSnapshotLuaTypeSchema,
        enumGameRule: LedgerLinkSnapshotLuaTypeSchema,
        rules: z.array(LedgerLinkSnapshotGameRuleSchema).max(64),
        rulesTruncated: z.boolean(),
        ledgerLink: z
            .object({
                value: z.enum(['normal', 'pvp', 'roleplaying', 'hardcore']).nullable(),
                source: z.enum(['set', 'detected']).nullable(),
            })
            .strict(),
    })
    .strict();

/** S1: one core call. Name-bearing calls (D4) are `status: 'presence'` with `type` only — never called. */
export const LedgerLinkSnapshotCallSchema = z
    .object({
        fn: ApiPathSchema,
        args: z.array(z.union([z.string().max(128), z.number(), z.boolean(), z.null()])).max(8).optional(),
        status: z.union([DevBridgeCallStatusSchema.exclude(['denied']), z.literal('presence')]),
        type: LedgerLinkSnapshotLuaTypeSchema.optional(),
        values: z.array(DevBridgeProbeValueSchema).max(40).optional(),
        error: SnapshotText(512).optional(),
        truncated: z.literal(true).optional(),
    })
    .strict();

/** S2 + the watched API list: presence only, nothing is called. */
export const LedgerLinkSnapshotApiSchema = z
    .object({ path: ApiPathSchema, type: LedgerLinkSnapshotLuaTypeSchema })
    .strict();

/** S3, S9, …: one `/rl probe` section's text lines, unchanged. `skipped` = the 50 ms time guard (D6). */
export const LedgerLinkSnapshotSectionSchema = z
    .object({
        id: SectionIdSchema,
        status: z.enum(['ok', 'error', 'skipped']),
        lines: z.array(SnapshotText(256)).max(40),
        error: SnapshotText(512).optional(),
        truncated: z.literal(true).optional(),
    })
    .strict();

/** The snapshot object without refinements — shared by the stored form and the page slice. */
const LedgerLinkSnapshotObject = z
    .object({
        snapshotVersion: z.literal(DEV_BRIDGE_SNAPSHOT_VERSION),
        addonVersion: SnapshotText(64).min(1),
        capturedAt: CompanionTimestampSchema,
        trigger: z.enum(['logout']),
        client: LedgerLinkSnapshotClientSchema,
        character: z
            .object({
                class: z.string().regex(/^[A-Z]{2,16}$/).nullable(),
                level: z.number().int().min(1).max(100).nullable(),
                faction: z.enum(['Alliance', 'Horde', 'Neutral']).nullable(),
                inGuild: z.boolean(),
            })
            .strict(),
        ruleset: LedgerLinkSnapshotRulesetSchema,
        calls: z.array(LedgerLinkSnapshotCallSchema).max(40),
        apis: z.array(LedgerLinkSnapshotApiSchema).max(160),
        sections: z.array(LedgerLinkSnapshotSectionSchema).max(9),
        truncated: z.boolean(),
    })
    .strict();

type SnapshotShape = z.output<typeof LedgerLinkSnapshotObject>;
type Path = (string | number)[];

/** Adds a `custom` issue at every string value or object key holding a player GUID. */
function checkNoGuid(value: unknown, path: Path, ctx: z.RefinementCtx): void {
    if (typeof value === 'string') {
        if (PLAYER_GUID_RE.test(value)) ctx.addIssue({ code: 'custom', path, message: 'A player GUID is not allowed in a dev snapshot' });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => checkNoGuid(v, [...path, i], ctx));
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) {
        if (PLAYER_GUID_RE.test(key)) ctx.addIssue({ code: 'custom', path: [...path, key], message: 'A player GUID is not allowed as a key' });
        checkNoGuid(v, [...path, key], ctx);
    }
}

/** `type` appears iff `status === 'presence'`, and a presence row is never called (no `values`). */
function checkPresenceRows(snap: SnapshotShape, ctx: z.RefinementCtx): void {
    snap.calls.forEach((call, i) => {
        const presence = call.status === 'presence';
        if (presence !== (call.type !== undefined) || (presence && call.values !== undefined)) {
            ctx.addIssue({ code: 'custom', path: ['calls', i], message: 'type is required with status presence (and values forbidden), and allowed only there' });
        }
    });
}

function checkUniqueApis(snap: SnapshotShape, ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    snap.apis.forEach((api, i) => {
        if (seen.has(api.path)) ctx.addIssue({ code: 'custom', path: ['apis', i], message: `Duplicate api path ${api.path}` });
        seen.add(api.path);
    });
}

function checkItemBytes(snap: SnapshotShape, ctx: z.RefinementCtx): void {
    const lists: [string, readonly unknown[]][] = [['calls', snap.calls], ['apis', snap.apis], ['sections', snap.sections]];
    for (const [key, items] of lists) {
        items.forEach((item, i) => {
            const bytes = devBridgeJsonBytes(item);
            if (bytes > DEV_BRIDGE_RESULT_ITEM_MAX_BYTES) {
                ctx.addIssue({ code: 'custom', path: [key, i], message: `Item is ${bytes} bytes; the cap is ${DEV_BRIDGE_RESULT_ITEM_MAX_BYTES}` });
            }
        });
    }
}

/** UTF-8 bytes of the snapshot without its `calls` / `apis` / `sections` arrays. */
export function devBridgeSnapshotHeadBytes(snap: SnapshotShape): number {
    const { calls: _c, apis: _a, sections: _s, ...head } = snap;
    return devBridgeJsonBytes(head);
}

/** Refinements of a page's snapshot slice: presence rows + GUID guard (arrays may be empty slices). */
export function checkSnapshotSlice(snap: SnapshotShape, ctx: z.RefinementCtx): void {
    checkPresenceRows(snap, ctx);
    checkNoGuid(snap, [], ctx);
}

/** Every refinement of a stored snapshot: slice rules + unique apis, item / head / whole byte caps. */
export function checkSnapshot(snap: SnapshotShape, ctx: z.RefinementCtx): void {
    checkUniqueApis(snap, ctx);
    checkSnapshotSlice(snap, ctx);
    checkItemBytes(snap, ctx);
    const head = devBridgeSnapshotHeadBytes(snap);
    if (head > DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES) {
        ctx.addIssue({ code: 'custom', path: [], message: `Snapshot head is ${head} bytes; the cap is ${DEV_BRIDGE_SNAPSHOT_HEAD_MAX_BYTES}` });
    }
    devBridgeMaxBytes(DEV_BRIDGE_SNAPSHOT_MAX_BYTES, 'Snapshot')(snap, ctx);
}

/** `ledgerlink-snapshot` — the JSON string LedgerLink stores per character (the companion receives it). */
export const LedgerLinkSnapshotSchema = LedgerLinkSnapshotObject.superRefine(checkSnapshot);

/** `sha256_hex(guid)` — equals `sv-parsed` `outbox[].guidHash` for the same character. */
export const DevBridgeCharacterKeySchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Companion-assigned history row id (ULID recommended). */
export const DevBridgeSnapshotIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** sha256 hex of the snapshot with `capturedAt` removed (D10). */
export const DevBridgeSnapshotDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

const fitsPage = devBridgeMaxBytes(DEV_BRIDGE_PAGE_MAX_BYTES, 'Response body');

const rowShape = {
    flavor: DevBridgeFlavorSchema,
    characterKey: DevBridgeCharacterKeySchema,
    snapshotId: DevBridgeSnapshotIdSchema,
    digest: DevBridgeSnapshotDigestSchema,
    receivedAt: CompanionTimestampSchema,
    lastCapturedAt: CompanionTimestampSchema,
    seenCount: z.number().int().min(1),
    latest: z.boolean(),
};

/** GET /dev/v1/ledgerlink/snapshot?flavor=&character=&at=&cursor= — the head + a slice of calls → apis → sections. */
export const DevBridgeSnapshotPageSchema = z
    .object({
        ...rowShape,
        snapshot: LedgerLinkSnapshotObject.superRefine(checkSnapshotSlice),
        next: DevBridgeNextSchema,
    })
    .strict()
    .superRefine(fitsPage);

/** One history row: the patch-day signals, without the snapshot body. */
export const DevBridgeSnapshotHistoryEntrySchema = z
    .object({
        ...rowShape,
        capturedAt: CompanionTimestampSchema,
        addonVersion: z.string().max(64),
        clientVersion: z.string().max(32),
        clientBuild: z.string().max(16),
        interface: z.number().int().min(0),
        missingApis: z.number().int().min(0),
        activeRules: z.array(z.string().max(64)).max(64),
        truncated: z.boolean(),
    })
    .strict();

/** GET /dev/v1/ledgerlink/snapshot/history?flavor=&character=&cursor= — newest first. */
export const DevBridgeSnapshotHistorySchema = z
    .object({ entries: z.array(DevBridgeSnapshotHistoryEntrySchema).max(100), next: DevBridgeNextSchema })
    .strict()
    .superRefine(fitsPage);

export type LedgerLinkSnapshot = z.output<typeof LedgerLinkSnapshotSchema>;
export type LedgerLinkSnapshotCall = z.output<typeof LedgerLinkSnapshotCallSchema>;
export type LedgerLinkSnapshotSection = z.output<typeof LedgerLinkSnapshotSectionSchema>;
export type DevBridgeSnapshotPage = z.output<typeof DevBridgeSnapshotPageSchema>;
export type DevBridgeSnapshotHistoryEntry = z.output<typeof DevBridgeSnapshotHistoryEntrySchema>;
export type DevBridgeSnapshotHistory = z.output<typeof DevBridgeSnapshotHistorySchema>;
