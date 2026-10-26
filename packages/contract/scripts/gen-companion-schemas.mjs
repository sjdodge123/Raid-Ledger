// Regenerates packages/contract/companion/envelope/v1/schema.json and
// companion/bg3-save/v1/schema.json from the Zod source of truth (ROK-1954).
// Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-schemas.mjs
// The api jest drift guard (api/src/companion/companion-contract.spec.ts)
// fails on any difference.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BG3_SAVE_CONTRACT_VERSION,
    COMPANION_ENVELOPE_VERSION,
    serializeBg3SaveJsonSchema,
    serializeCompanionEnvelopeJsonSchema,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'companion');
const outputs = [
    [join(root, 'envelope', `v${COMPANION_ENVELOPE_VERSION}`, 'schema.json'), serializeCompanionEnvelopeJsonSchema()],
    [join(root, 'bg3-save', `v${BG3_SAVE_CONTRACT_VERSION}`, 'schema.json'), serializeBg3SaveJsonSchema()],
];
for (const [out, body] of outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
    console.log(`wrote ${out}`);
}
