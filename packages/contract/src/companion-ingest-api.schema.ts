import { z } from 'zod';
import { CompanionHubGuildIdSchema, CompanionSha256Schema, CompanionVersionStringSchema } from './companion-common.schema.js';
import {
    COMPANION_CONTRACT_VERSION_MAX,
    CompanionContractIdSchema,
    CompanionIngestErrorCodeSchema,
} from './companion-envelope.schema.js';

// ============================================================
// Companion ingest HTTP API (ROK-1956, C3) — additive to envelope v1.
//
// The error body every ingest/blob refusal returns, the blob-upload ack and
// the `GET /companion/v1/config` document. All server→client: the app MUST
// ignore unknown `/config` keys and treat an unknown error `code` as a
// generic terminal 4xx (`companion/envelope/v1/CONTRACT.md` §4).
// ============================================================

/** Most validation issues one error body lists. */
export const COMPANION_INGEST_ISSUES_MAX = 20;

/**
 * One validation issue: WHERE it failed and Zod's issue code. Deliberately
 * no `message`/`received` — an error body never echoes payload values.
 */
export const CompanionIngestIssueSchema = z.object({
    path: z.string().max(200),
    code: z.string().max(40),
}).strict();
export type CompanionIngestIssue = z.infer<typeof CompanionIngestIssueSchema>;

/** Body of every ingest/blob/config error answer. */
export const CompanionIngestErrorSchema = z.object({
    code: CompanionIngestErrorCodeSchema,
    message: z.string().max(200),
    /** Set on `unknown_contract_version` / `retired_contract_version`. */
    currentVersion: z.number().int().min(1).max(COMPANION_CONTRACT_VERSION_MAX).optional(),
    /** Set on `invalid_envelope` / `invalid_payload`. */
    issues: z.array(CompanionIngestIssueSchema).max(COMPANION_INGEST_ISSUES_MAX).optional(),
}).strict();
export type CompanionIngestError = z.infer<typeof CompanionIngestErrorSchema>;

/** `PUT /companion/v1/blobs/:sha256` success: `stored` (201) or `exists` (200). */
export const CompanionBlobAckSchema = z.object({
    status: z.enum(['stored', 'exists']),
    sha256: CompanionSha256Schema,
}).strict();
export type CompanionBlobAck = z.infer<typeof CompanionBlobAckSchema>;

/** Global caps the app must respect before sending. */
export const CompanionConfigLimitsSchema = z.object({
    messageMaxBytes: z.number().int().positive(),
    webpMaxBytes: z.number().int().positive(),
    imageEdgeMax: z.number().int().positive(),
    capturedAtMaxFutureMs: z.number().int().positive(),
}).strict();
export type CompanionConfigLimits = z.infer<typeof CompanionConfigLimitsSchema>;

/** The caller's own rate limits per minute; `null` = unlimited. */
export const CompanionConfigRateSchema = z.object({
    messagesPerMin: z.number().int().positive().nullable(),
    blobsPerMin: z.number().int().positive().nullable(),
}).strict();
export type CompanionConfigRate = z.infer<typeof CompanionConfigRateSchema>;

/** ROK-2067 D1/D2 — the contract's owner plugin and its state on this server. */
export const CompanionConfigPluginSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    state: z.enum(['active', 'inactive', 'not_installed']),
}).strict();
export type CompanionConfigPlugin = z.infer<typeof CompanionConfigPluginSchema>;

/** ROK-2067 D13 — the owner plugin's game, for the app's tile art. */
export const CompanionConfigGameSchema = z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    coverUrl: z.string().min(1).nullable(),
}).strict();
export type CompanionConfigGame = z.infer<typeof CompanionConfigGameSchema>;

/** Most hub targets one `/config` contract entry lists. */
export const COMPANION_CONFIG_HUB_TARGETS_MAX = 100;

/** ROK-1966 Q3 — one hub the caller is a live member of, offered in the app's hub picker. */
export const CompanionConfigHubTargetSchema = z.object({
    hubGuildId: CompanionHubGuildIdSchema,
    name: z.string().min(1),
    /** The pre-selected pick: the hub of the caller's most recent save's campaign (at most one per list). */
    isDefault: z.boolean(),
}).strict();
export type CompanionConfigHubTarget = z.infer<typeof CompanionConfigHubTargetSchema>;

/** One registry contract as the server currently serves it. */
export const CompanionConfigContractSchema = z.object({
    id: CompanionContractIdSchema,
    /** False when no handler is registered or its owner plugin is off. */
    enabled: z.boolean(),
    versions: z.array(z.object({
        version: z.number().int().min(1).max(COMPANION_CONTRACT_VERSION_MAX),
        status: z.enum(['current', 'accepted', 'retired']),
    }).strict()),
    /** Decoded byte cap of the current version. */
    maxBytes: z.number().int().positive(),
    blobSlots: z.array(z.enum(['thumbnail', 'image'])),
    cadence: z.object({ minIntervalSec: z.number().int().positive() }).strict(),
    /** Owner plugin; `null` = no handler registered. Absent from older servers. */
    plugin: CompanionConfigPluginSchema.nullable().optional(),
    /** Owner plugin's game; `null` = no `games` row. Absent from older servers. */
    game: CompanionConfigGameSchema.nullable().optional(),
    /**
     * ROK-1966 — hubs the caller may name in `payload.target.hubGuildId` (only
     * contracts whose payload has a target, e.g. `bg3-screenshot`). Absent from
     * older servers and for contracts without a target; `[]` = none to pick.
     */
    hubTargets: z.array(CompanionConfigHubTargetSchema).max(COMPANION_CONFIG_HUB_TARGETS_MAX).optional(),
}).strict();
export type CompanionConfigContract = z.infer<typeof CompanionConfigContractSchema>;

/**
 * `GET /companion/v1/config`. Anonymous callers get `minAppVersion` + `limits`
 * only; an authenticated caller (device token or session) also gets `rate`
 * and `contracts`.
 */
export const CompanionConfigSchema = z.object({
    configVersion: z.literal(1),
    minAppVersion: CompanionVersionStringSchema,
    limits: CompanionConfigLimitsSchema,
    rate: CompanionConfigRateSchema.optional(),
    contracts: z.array(CompanionConfigContractSchema).optional(),
}).strict();
export type CompanionConfig = z.infer<typeof CompanionConfigSchema>;
