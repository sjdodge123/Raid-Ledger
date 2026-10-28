import { z } from 'zod';
import { CompanionSha256Schema, CompanionVersionStringSchema } from './companion-common.schema.js';
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
    blobSlots: z.array(z.enum(['thumbnail'])),
    cadence: z.object({ minIntervalSec: z.number().int().positive() }).strict(),
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
