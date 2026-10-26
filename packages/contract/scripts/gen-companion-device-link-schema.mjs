// Regenerates packages/contract/companion/device-link/v1/schema.json from the
// Zod source of truth (ROK-1955). Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-companion-device-link-schema.mjs
// The contract vitest drift guard
// (src/__tests__/companion-device-link-contract.spec.ts) fails on any difference.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COMPANION_DEVICE_LINK_CONTRACT_VERSION,
    serializeCompanionDeviceLinkJsonSchema,
} from '../dist/index.js';

const out = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'companion',
    'device-link',
    `v${COMPANION_DEVICE_LINK_CONTRACT_VERSION}`,
    'schema.json',
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, serializeCompanionDeviceLinkJsonSchema());
console.log(`wrote ${out}`);
