// Regenerates packages/contract/ledgerlink/v2/schema.json from the Zod
// source of truth (AddonExportV2Schema). Run via
// `npm run gen:ledgerlink-schema -w @raid-ledger/contract` (builds dist first).
// v1/schema.json is FROZEN since ROK-2184 and is never rewritten here; its
// drift guard still compares it with serializeLedgerLinkJsonSchema().
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ADDON_EXPORT_V2_ENVELOPE_VERSION,
    serializeLedgerLinkV2JsonSchema,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ledgerlink', `v${ADDON_EXPORT_V2_ENVELOPE_VERSION}`, 'schema.json');
writeFileSync(out, serializeLedgerLinkV2JsonSchema());
console.log(`wrote ${out}`);
