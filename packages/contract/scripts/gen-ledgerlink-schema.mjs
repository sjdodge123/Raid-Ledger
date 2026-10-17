// Regenerates packages/contract/ledgerlink/v1/schema.json from the Zod
// source of truth. Run via `npm run gen:ledgerlink-schema -w @raid-ledger/contract`
// (builds dist first). The api jest drift guard fails on any difference.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ADDON_EXPORT_ENVELOPE_VERSION,
    serializeLedgerLinkJsonSchema,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ledgerlink', `v${ADDON_EXPORT_ENVELOPE_VERSION}`, 'schema.json');
writeFileSync(out, serializeLedgerLinkJsonSchema());
console.log(`wrote ${out}`);
