#!/usr/bin/env node
/**
 * Regenerates `web/src/styles/semantic-hue.baseline.json` (ROK-1586, TDB:1770).
 *
 *   node web/scripts/semantic-hue-baseline.mjs                  lower counts, drop emptied entries
 *   node web/scripts/semantic-hue-baseline.mjs --init --force   rewrite from scratch (only when the
 *                                                               counted set itself changes)
 *
 * Without `--init` it refuses a raised count, and a new file unless that file is in
 * `semantic-hue.categorical.json` with a reason. `--init` refuses to overwrite an existing
 * baseline unless `--force` is also passed, so a regression cannot be frozen by accident.
 * It imports the guard's own counter (`src/styles/semantic-hue.count.ts`), so it needs
 * native type stripping: Node >= 22.18 (or >= 23.6). The import is dynamic so the version
 * check below runs before Node tries to load a `.ts` file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18))) {
    console.error(`semantic-hue-baseline needs Node >= 22.18 (native .ts type stripping); this is Node ${process.versions.node}`);
    process.exit(1);
}
const { TOTAL_KEY, countTree, nextBaseline, serializeBaseline } = await import('../src/styles/semantic-hue.count.ts');

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const STYLES = join(SRC, 'styles');
const BASELINE = join(STYLES, 'semantic-hue.baseline.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const reader = { list: (root) => readdirSync(root, { recursive: true }), read: (path) => readFileSync(path, 'utf-8') };

const init = process.argv.includes('--init');
if (init && existsSync(BASELINE) && !process.argv.includes('--force')) {
    console.error('semantic-hue baseline already exists: --init would freeze any regression into it. Run without --init to lower counts, or pass --init --force only when the counted set itself changed.');
    process.exit(1);
}
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
