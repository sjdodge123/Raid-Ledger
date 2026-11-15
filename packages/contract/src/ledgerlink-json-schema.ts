import { z } from 'zod';
import {
    ADDON_EXPORT_ENVELOPE_VERSION,
    AddonExportSchema,
} from './wow-addon-export.schema.js';
import {
    ADDON_EXPORT_V2_ENVELOPE_VERSION,
    AddonExportV2Schema,
} from './wow-addon-v2.schema.js';

/**
 * LedgerLink wire contract (operator ruling 2026-10-05): Raid Ledger owns
 * the addon export format; `packages/contract/ledgerlink/v<n>/schema.json`
 * is GENERATED from `AddonExportSchema` by this function. Regenerate with
 * `npm run gen:ledgerlink-schema -w @raid-ledger/contract`; an api jest
 * drift guard fails when the committed file differs.
 */
export const LEDGERLINK_SCHEMA_ID =
    `https://github.com/sjdodge123/Raid-Ledger/blob/main/packages/contract/ledgerlink/v${ADDON_EXPORT_ENVELOPE_VERSION}/schema.json`;

/** The JSON Schema object for the decoded export payload. */
export function buildLedgerLinkJsonSchema(): Record<string, unknown> {
    const generated = z.toJSONSchema(AddonExportSchema, {
        target: 'draft-2020-12',
        // INPUT mode: what the server ACCEPTS. A `.strict()` object becomes
        // `additionalProperties: false`; output mode would emit that for every
        // object and hide a loosened schema from the drift guard.
        io: 'input',
        unrepresentable: 'throw',
    }) as Record<string, unknown>;
    return {
        ...generated,
        $id: LEDGERLINK_SCHEMA_ID,
        title: `LedgerLink addon export payload v${ADDON_EXPORT_ENVELOPE_VERSION}`,
        description:
            'GENERATED from AddonExportSchema (packages/contract/src/wow-addon-export.schema.ts) — do not edit by hand. See CONTRACT.md.',
    };
}

/** Exact file contents of `schema.json` (2-space indent, trailing newline). */
export function serializeLedgerLinkJsonSchema(): string {
    return `${JSON.stringify(buildLedgerLinkJsonSchema(), null, 2)}\n`;
}

// ---------- v2 (ROK-2184) ----------
// `v1/schema.json` is FROZEN: the generator script writes only v2 from here
// on; the v1 functions above remain for the v1 drift guard.

export const LEDGERLINK_V2_SCHEMA_ID =
    `https://github.com/sjdodge123/Raid-Ledger/blob/main/packages/contract/ledgerlink/v${ADDON_EXPORT_V2_ENVELOPE_VERSION}/schema.json`;

/** The JSON Schema object for a decoded `!RL2!` payload. */
export function buildLedgerLinkV2JsonSchema(): Record<string, unknown> {
    const generated = z.toJSONSchema(AddonExportV2Schema, {
        target: 'draft-2020-12',
        io: 'input',
        unrepresentable: 'throw',
    }) as Record<string, unknown>;
    return {
        ...generated,
        $id: LEDGERLINK_V2_SCHEMA_ID,
        title: `LedgerLink addon export payload v${ADDON_EXPORT_V2_ENVELOPE_VERSION}`,
        description:
            'GENERATED from AddonExportV2Schema (packages/contract/src/wow-addon-v2.schema.ts) — do not edit by hand. See CONTRACT.md.',
    };
}

/** Exact file contents of `v2/schema.json` (2-space indent, trailing newline). */
export function serializeLedgerLinkV2JsonSchema(): string {
    return `${JSON.stringify(buildLedgerLinkV2JsonSchema(), null, 2)}\n`;
}
