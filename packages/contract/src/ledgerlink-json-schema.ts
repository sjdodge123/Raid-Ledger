import { z } from 'zod';
import {
    ADDON_EXPORT_ENVELOPE_VERSION,
    AddonExportSchema,
} from './wow-addon-export.schema.js';

/**
 * LedgerLink wire contract (operator ruling 2026-10-05): Raid Ledger owns
 * the addon export format; `packages/contract/ledgerlink/v<n>/schema.json`
 * is GENERATED from `AddonExportSchema` by this function. Regenerate with
 * `npm run gen:ledgerlink-schema -w @raid-ledger/contract`; an api jest
 * drift guard fails when the committed file differs.
 */
export const LEDGERLINK_SCHEMA_ID =
    `https://raid.gamernight.net/contracts/ledgerlink/v${ADDON_EXPORT_ENVELOPE_VERSION}/schema.json`;

/** The JSON Schema object for the decoded export payload. */
export function buildLedgerLinkJsonSchema(): Record<string, unknown> {
    const generated = z.toJSONSchema(AddonExportSchema, {
        target: 'draft-2020-12',
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
