import { z } from 'zod';
import { COMPANION_MESSAGE_MAX_BYTES } from './companion-common.schema.js';
import { companionEnvelopeShape } from './companion-envelope.schema.js';

// ============================================================
// `wow-ledgerlink` v1 (ROK-1964) — `companion/wow-ledgerlink/v1/`.
//
// One LedgerLink export run, read by the Companion from the addon's
// SavedVariables outbox and pushed as-is. The payload WRAPS the unchanged
// LedgerLink v1 export string (`packages/contract/ledgerlink/v1/`); the
// server feeds it to the same decoder as a paste. This contract does not
// validate the string's inner format — the LedgerLink decoder does.
// ============================================================

/** Registry id and version of this contract. */
export const WOW_LEDGERLINK_CONTRACT_ID = 'wow-ledgerlink';
export const WOW_LEDGERLINK_CONTRACT_VERSION = 1;

/**
 * Longest `exportString` (UTF-16 units; LedgerLink strings are ASCII, so
 * bytes too): 256 KiB − 2 KiB, so the envelope around a maximal ASCII
 * string still fits `COMPANION_MESSAGE_MAX_BYTES` (spec D3). A paste at
 * the full `ADDON_IMPORT_MAX_BYTES` (262 144) cannot fit inside an envelope.
 */
export const COMPANION_WOW_LEDGERLINK_EXPORT_MAX = 260_096;

/** Decoded JSON body cap for a `wow-ledgerlink` v1 message: the global ceiling. */
export const COMPANION_WOW_LEDGERLINK_MAX_BYTES = COMPANION_MESSAGE_MAX_BYTES;

/** The payload: one LedgerLink v1 export string (one or more `!RL1!` tokens, newline-separated). */
export const WowLedgerlinkPayloadSchema = z.object({
    exportString: z.string().min(1).max(COMPANION_WOW_LEDGERLINK_EXPORT_MAX),
}).strict();
export type WowLedgerlinkPayload = z.infer<typeof WowLedgerlinkPayloadSchema>;

/** Full `wow-ledgerlink` v1 message: the envelope with literals + the strict payload. */
export const WowLedgerlinkMessageSchema = z.object({
    ...companionEnvelopeShape,
    contract: z.literal(WOW_LEDGERLINK_CONTRACT_ID),
    contractVersion: z.literal(WOW_LEDGERLINK_CONTRACT_VERSION),
    payload: WowLedgerlinkPayloadSchema,
}).strict();
export type WowLedgerlinkMessage = z.infer<typeof WowLedgerlinkMessageSchema>;
