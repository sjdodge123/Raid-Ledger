import { z } from 'zod';
import { companionDisplayTextSchema, CompanionTimestampSchema, CompanionVersionStringSchema } from './companion-common.schema.js';
import {
    DEV_BRIDGE_CONTRACT_VERSION,
    DEV_BRIDGE_PAGE_MAX_BYTES,
    devBridgeMaxBytes,
    DevBridgeEchoedProbeRequestSchema,
    DevBridgeFlavorSchema,
    DevBridgeNextSchema,
    DevBridgeProbeIdSchema,
    DevBridgeProbeResultSchema,
} from './companion-dev-bridge.schema.js';
import { DevBridgeBg3CatalogueReportSchema } from './companion-dev-bridge-bg3-catalogue-report.schema.js';

// ============================================================
// Companion dev bridge v1 — `/dev/v1/*` response bodies (ROK-2055 §6).
// Every body, serialised, is ≤ DEV_BRIDGE_PAGE_MAX_BYTES; a list or text that
// would not fit is paged with `?cursor=` and carries `next` (null = last page).
// ============================================================

/** A relative path (to the configured WoW folder, or for BG3 to the install's `Data/` / inside a pak): forward slashes, no leading `/`, no `..`, no drive. */
export const DevBridgeRelativePathSchema = z
    .string()
    .min(1)
    .max(512)
    .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.includes(':'), {
        message: 'Must be a relative path, with forward slashes',
    })
    .refine((p) => p.split('/').every((s) => s !== '' && s !== '.' && s !== '..'), {
        message: 'Must not contain empty, "." or ".." segments',
    });

const Name = z.string().min(1).max(128);

/** Every response body: ≤ DEV_BRIDGE_PAGE_MAX_BYTES serialised (UTF-8), a root-level `custom` issue otherwise. */
const fitsPage = devBridgeMaxBytes(DEV_BRIDGE_PAGE_MAX_BYTES, 'Response body');
const Count = z.number().int().min(0);

/** GET /dev/v1/health */
export const DevBridgeHealthSchema = z
    .object({
        app: z.literal('rl-companion'),
        appVersion: CompanionVersionStringSchema,
        bridgeVersion: z.literal(DEV_BRIDGE_CONTRACT_VERSION),
        devMode: z.literal(true),
        probesEnabled: z.boolean(),
        wowDir: z.string().max(512).nullable(),
        flavors: z.array(DevBridgeFlavorSchema).max(16),
        wowRunning: z.boolean(),
        uptimeSec: Count,
        now: CompanionTimestampSchema,
    })
    .strict()
    .superRefine(fitsPage);

/** One addon, from its `.toc` header only. `interface` is the raw `## Interface:` value (may list several). */
export const DevBridgeAddonSchema = z
    .object({
        folder: Name,
        title: z.string().max(256).nullable(),
        version: z.string().max(64).nullable(),
        interface: z.string().max(64).nullable(),
        savedVariables: z.array(Name).max(32),
        loadOnDemand: z.boolean(),
    })
    .strict();

/** GET /dev/v1/addons?flavor=&cursor= */
export const DevBridgeAddonsSchema = z
    .object({ flavor: DevBridgeFlavorSchema, addons: z.array(DevBridgeAddonSchema).max(200), next: DevBridgeNextSchema })
    .strict()
    .superRefine(fitsPage);

/** Which SavedVariables file: the account-wide one or a per-character one (the newest by mtime). */
export const DevBridgeSvScopeSchema = z.enum(['account', 'character']);

/**
 * Addon folders whose SavedVariables `GET /dev/v1/addons/<folder>/sv` may
 * read (body `sv-raw`). Other addons' saved data can hold whispers and chat
 * history, so only addons the operator owns or that hold only error reports
 * are listed. LedgerLink is not here: it has its own `ledgerlink/sv` route.
 * Adding a folder is additive; any other folder is a 404 `not_found`.
 */
export const DEV_BRIDGE_SV_READABLE_ADDONS = ['Mailworthy', '!BugGrabber'] as const;

/** The `<folder>` path segment of `GET /dev/v1/addons/<folder>/sv`. */
export const DevBridgeSvReadableAddonSchema = z.enum(DEV_BRIDGE_SV_READABLE_ADDONS);

export type DevBridgeSvReadableAddon = z.infer<typeof DevBridgeSvReadableAddonSchema>;

/**
 * One page of a raw SavedVariables file: `GET /dev/v1/ledgerlink/sv?flavor=&scope=&cursor=`
 * (`LedgerLink.lua`) and `GET /dev/v1/addons/<folder>/sv?flavor=&scope=&cursor=` (`<folder>.lua`).
 */
export const DevBridgeSvRawSchema = z
    .object({
        flavor: DevBridgeFlavorSchema,
        scope: DevBridgeSvScopeSchema,
        path: DevBridgeRelativePathSchema,
        bytes: Count,
        mtime: CompanionTimestampSchema,
        text: z.string().max(12_288),
        next: DevBridgeNextSchema,
    })
    .strict()
    .superRefine(fitsPage);

/** One outbox entry of a parsed LedgerLink SavedVariables file — GUIDs hashed, no names. */
export const DevBridgeSvOutboxEntrySchema = z
    .object({
        guidHash: z.string().regex(/^[0-9a-f]{16,64}$/),
        section: Name,
        source: Name,
        at: CompanionTimestampSchema.nullable(),
        exportedAt: CompanionTimestampSchema.nullable(),
        pages: Count,
        bytes: Count,
        decodes: z.boolean(),
    })
    .strict();

/** One parsed SavedVariables file. `realm`/`character` only on the character scope. */
export const DevBridgeSvFileSchema = z
    .object({
        scope: DevBridgeSvScopeSchema,
        account: Name,
        realm: Name.optional(),
        character: Name.optional(),
        mtime: CompanionTimestampSchema,
        topKeys: z.array(Name).max(64),
        outbox: z.array(DevBridgeSvOutboxEntrySchema).max(100),
        blockedCount: Count,
        region: z.string().max(16).nullable(),
    })
    .strict();

/** GET /dev/v1/ledgerlink/sv/parsed?flavor=&cursor= */
export const DevBridgeSvParsedSchema = z
    .object({ flavor: DevBridgeFlavorSchema, files: z.array(DevBridgeSvFileSchema).max(50), next: DevBridgeNextSchema })
    .strict()
    .superRefine(fitsPage);

/** Probe lifecycle. `cancelled` only after DELETE; `rejected` when the result failed ProbeResult. */
export const DevBridgeProbeStatusSchema = z.enum(['queued', 'answered', 'expired', 'rejected', 'cancelled']);

/** POST /dev/v1/probes → 202 */
export const DevBridgeProbeQueuedSchema = z
    .object({
        probeId: DevBridgeProbeIdSchema,
        status: z.literal('queued'),
        flavor: DevBridgeFlavorSchema,
        answersOn: z.string().min(1).max(200),
    })
    .strict()
    .superRefine(fitsPage);

/** One row of GET /dev/v1/probes. */
export const DevBridgeProbeSummarySchema = z
    .object({
        probeId: DevBridgeProbeIdSchema,
        title: companionDisplayTextSchema(120),
        status: DevBridgeProbeStatusSchema,
        submittedAt: CompanionTimestampSchema,
        answeredAt: CompanionTimestampSchema.optional(),
    })
    .strict();

/** GET /dev/v1/probes?status=&cursor= */
export const DevBridgeProbeListSchema = z
    .object({ probes: z.array(DevBridgeProbeSummarySchema).max(100), next: DevBridgeNextSchema })
    .strict()
    .superRefine(fitsPage);

/**
 * GET /dev/v1/probes/:id?cursor= — paged by result ITEM (a call without its
 * iterations, or one iteration): each page repeats the other fields; a forEach
 * call whose iterations span pages repeats its whole head (the call without
 * `iterations`, ≤3 KiB) with the next slice. Request ≤4 KiB + head + one
 * iteration always fits (worst case 14,132 B).
 */
export const DevBridgeProbeDetailSchema = DevBridgeProbeSummarySchema.extend({
    request: DevBridgeEchoedProbeRequestSchema,
    result: DevBridgeProbeResultSchema.optional(),
    error: z.string().max(512).optional(),
    next: DevBridgeNextSchema,
})
    .strict()
    .superRefine(fitsPage);

/** DELETE /dev/v1/probes/:id → 200 */
export const DevBridgeProbeCancelledSchema = z
    .object({ probeId: DevBridgeProbeIdSchema, status: z.literal('cancelled') })
    .strict()
    .superRefine(fitsPage);

/** A secret that must never reach a log line: a device/dev token, or a bearer value. */
const LOG_SECRET_RE = /rlcd(ev)?_[A-Za-z0-9_-]|bearer\s+(?!<redacted>(?![A-Za-z0-9_-]))\S/i;

/** One companion log line, already redacted (`<redacted>` replaces every token). */
export const DevBridgeLogLineSchema = z
    .object({
        at: CompanionTimestampSchema,
        level: z.enum(['error', 'warn', 'info', 'debug', 'trace']),
        target: z.string().max(128),
        msg: z.string().max(2048).refine((m) => !LOG_SECRET_RE.test(m), { message: 'Log line holds an unredacted secret' }),
    })
    .strict();

/** GET /dev/v1/logs?since=&level=&cursor= */
export const DevBridgeLogsSchema = z
    .object({ lines: z.array(DevBridgeLogLineSchema).max(500), next: DevBridgeNextSchema })
    .strict()
    .superRefine(fitsPage);

/** One collector, the same data as the app's `get_collector_status`. */
export const DevBridgeCollectorSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        enabled: z.boolean(),
        paused: z.boolean(),
        lastScanAt: CompanionTimestampSchema.nullable(),
        lastUploadAt: CompanionTimestampSchema.nullable(),
        pending: Count,
        lastError: z.string().max(512).optional(),
    })
    .strict();

/** GET /dev/v1/collectors — `bg3Catalogue` (optional, ROK-2081): the BG3 game-data catalogue state, body-level, not a row. */
export const DevBridgeCollectorsSchema = z
    .object({ collectors: z.array(DevBridgeCollectorSchema).max(32), bg3Catalogue: DevBridgeBg3CatalogueReportSchema.optional() })
    .strict()
    .superRefine(fitsPage);

/** One request-validation issue (400 `invalid_request`). */
export const DevBridgeIssueSchema = z
    .object({
        path: z.array(z.union([z.string(), z.number()])).max(16),
        code: z.string().max(64),
        message: z.string().max(512),
    })
    .strict();

/**
 * Every error body. 401/403/429/500 carry the code only — no detail. Only `invalid_request` has `issues`.
 * `internal` (500): an unexpected companion failure while serving the request.
 */
export const DevBridgeErrorSchema = z
    .object({
        error: z.enum(['invalid_request', 'unauthorized', 'forbidden', 'rate_limited', 'not_found', 'probes_disabled', 'internal']),
        issues: z.array(DevBridgeIssueSchema).max(50).optional(),
    })
    .strict()
    .superRefine(fitsPage);

export type DevBridgeHealth = z.output<typeof DevBridgeHealthSchema>;
export type DevBridgeProbeDetail = z.output<typeof DevBridgeProbeDetailSchema>;
export type DevBridgeLogs = z.output<typeof DevBridgeLogsSchema>;
export type DevBridgeError = z.output<typeof DevBridgeErrorSchema>;
