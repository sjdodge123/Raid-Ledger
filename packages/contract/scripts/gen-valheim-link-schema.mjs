// Regenerates packages/contract/valheim-link/v1/schema.json from the Zod
// source of truth (ROK-1829). Build dist first:
//   npm run build -w packages/contract && node packages/contract/scripts/gen-valheim-link-schema.mjs
// The api jest drift guard (api/src/plugins/valheim/valheim-link-contract.spec.ts)
// fails on any difference.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VALHEIM_LINK_SCHEMA_VERSION,
    serializeValheimLinkJsonSchema,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'valheim-link', `v${VALHEIM_LINK_SCHEMA_VERSION}`, 'schema.json');
writeFileSync(out, serializeValheimLinkJsonSchema());
console.log(`wrote ${out}`);
