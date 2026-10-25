import { z } from 'zod';
import {
    COMPANION_ENVELOPE_VERSION,
    CompanionTimestampSchema,
    CompanionVersionStringSchema,
} from './companion-common.schema.js';

// ============================================================
// Companion envelope v1 (ROK-1954) — `companion/envelope/v1/`.
//
// Two-stage parse: the server parses `CompanionEnvelopeSchema` first
// (`payload` opaque), uses `contract` + `contractVersion` to pick a registry
// entry, then parses the WHOLE body with that contract's message schema. So
// `contract` is an open string here: an unknown id is a registry miss
// (`unknown_contract`), never a parse error.
// ============================================================

/** Registry contract id, e.g. `bg3-save`: lowercase, 2–40 chars. */
export const CompanionContractIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
export type CompanionContractId = z.infer<typeof CompanionContractIdSchema>;

/** Highest `contractVersion` the envelope admits. */
export const COMPANION_CONTRACT_VERSION_MAX = 999;

/**
 * Envelope fields WITHOUT `payload`; each contract's message schema spreads
 * this and narrows `contract`/`contractVersion` to literals.
 */
export const companionEnvelopeShape = {
    envelopeVersion: z.literal(COMPANION_ENVELOPE_VERSION),
    contract: CompanionContractIdSchema,
    contractVersion: z.number().int().min(1).max(COMPANION_CONTRACT_VERSION_MAX),
    capturedAt: CompanionTimestampSchema,
    appVersion: CompanionVersionStringSchema,
    collectorVersion: CompanionVersionStringSchema,
} as const;

/**
 * Stage-one envelope. `payload` is opaque here; Zod 4 still requires the key
 * to be present (a missing `payload` fails), and it emits `{}` in JSON Schema.
 */
export const CompanionEnvelopeSchema = z.object({
    ...companionEnvelopeShape,
    payload: z.unknown(),
}).strict();
export type CompanionEnvelope = z.infer<typeof CompanionEnvelopeSchema>;

/** Success body: `stale` = an older snapshot than the one already stored. */
export const CompanionIngestAckSchema = z.object({
    status: z.enum(['accepted', 'stale']),
}).strict();
export type CompanionIngestAck = z.infer<typeof CompanionIngestAckSchema>;

/**
 * Error `code` strings are wire (the desktop app pins them); new codes are
 * additive. HTTP statuses are the ingest endpoint's call (ROK C3).
 */
export const CompanionIngestErrorCodeSchema = z.enum([
    'invalid_envelope',
    'unknown_contract',
    'unknown_contract_version',
    'retired_contract_version',
    'invalid_payload',
    'payload_too_large',
    'captured_at_in_future',
    'unauthorized',
    'rate_limited',
]);
export type CompanionIngestErrorCode = z.infer<typeof CompanionIngestErrorCodeSchema>;
