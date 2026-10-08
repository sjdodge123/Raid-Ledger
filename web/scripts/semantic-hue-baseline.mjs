#!/usr/bin/env node
/**
 * Regenerates `web/src/styles/semantic-hue.baseline.json` (ROK-1586, TDB:1770).
 *
 *   node web/scripts/semantic-hue-baseline.mjs          lower counts, drop emptied entries
 *   node web/scripts/semantic-hue-baseline.mjs --init   rewrite from scratch (slice S0 only)
 *
 * Without `--init` it refuses a raised count, and a new file unless that file is in
 * `semantic-hue.categorical.json` with a reason. It imports the guard's own counter
 * (`src/styles/semantic-hue.count.ts`), so it needs Node >= 22.18 (native type stripping).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOTAL_KEY, countTree, nextBaseline, serializeBaseline } from '../src/styles/semantic-hue.count.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const STYLES = join(SRC, 'styles');
const BASELINE = join(STYLES, 'semantic-hue.baseline.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const reader = { list: (root) => readdirSync(root, { recursive: true }), read: (path) => readFileSync(path, 'utf-8') };

const init = process.argv.includes('--init');
const baseline = init ? {} : readJson(BASELINE);
const categorical = readJson(join(STYLES, 'semantic-hue.categorical.json'));
const { counts, errors } = nextBaseline(countTree(SRC, reader), baseline, categorical, init);
if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
}
const text = serializeBaseline(counts);
writeFileSync(BASELINE, text);
console.log(`semantic-hue baseline: ${Object.keys(counts).length} files, ${TOTAL_KEY} ${JSON.parse(text)[TOTAL_KEY]}`);
