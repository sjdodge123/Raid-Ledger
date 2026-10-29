// Regenerates packages/contract/companion/envelope/v1/schema.json,
// companion/bg3-save/v1/schema.json, companion/wow-ledgerlink/v1/schema.json and
// companion/device-link/v1/schema.json from the Zod source of truth (ROK-1954,
// ROK-1955, ROK-1964).
// Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs
// The api jest drift guard (api/src/companion/companion-contract.spec.ts)
// fails on any difference.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BG3_SAVE_CONTRACT_VERSION,
    COMPANION_DEVICE_LINK_CONTRACT_VERSION,
    COMPANION_ENVELOPE_VERSION,
    serializeBg3SaveJsonSchema,
    serializeCompanionDeviceLinkJsonSchema,
    serializeCompanionEnvelopeJsonSchema,
    serializeWowLedgerlinkJsonSchema,
    WOW_LEDGERLINK_CONTRACT_VERSION,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'companion');
const outputs = [
    [join(root, 'envelope', `v${COMPANION_ENVELOPE_VERSION}`, 'schema.json'), serializeCompanionEnvelopeJsonSchema()],
    [join(root, 'bg3-save', `v${BG3_SAVE_CONTRACT_VERSION}`, 'schema.json'), serializeBg3SaveJsonSchema()],
    [join(root, 'wow-ledgerlink', `v${WOW_LEDGERLINK_CONTRACT_VERSION}`, 'schema.json'), serializeWowLedgerlinkJsonSchema()],
    [
        join(root, 'device-link', `v${COMPANION_DEVICE_LINK_CONTRACT_VERSION}`, 'schema.json'),
        serializeCompanionDeviceLinkJsonSchema(),
    ],
];
for (const [out, body] of outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    console.log(`wrote ${out}`);
}
