#!/usr/bin/env node
/**
 * check-bundle-size.mjs — ROK-1154 web bundle-size budget gate.
 *
 *   node scripts/check-bundle-size.mjs [--dist <dir>] [--config <file>] [--all]
 *
 * Measures every `.js` chunk in `<dist>/assets` (default `web/dist`) with
 * `zlib.gzipSync` level 9 and compares it with `scripts/bundle-budget.config.mjs`:
 *   - entry  — the `<script type="module">` chunk index.html loads;
 *   - vendor — chunks whose hash-stripped name is a vendor group key; all
 *              chunks sharing that name are summed (rolldown splits `sentry`
 *              into two);
 *   - shared — any other chunk index.html modulepreloads;
 *   - lazy   — everything else.
 * Shared and lazy chunks use their named budget, else the default lazy cap.
 * A `total` row sums the entry + every chunk index.html loads eagerly.
 *
 * Prints a table (chunk, class, gzip KB, budget, headroom). Exit 0 when every
 * row is within budget; exit 1 on any overrun, on a missing index.html /
 * assets dir / entry script, or on bad arguments — an empty build never passes.
 * `--all` lists every chunk; by default only budgeted rows, the five largest
 * default-cap chunks and any failure are listed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(SCRIPT_DIR, '..', 'web', 'dist');
const DEFAULT_CONFIG = path.join(SCRIPT_DIR, 'bundle-budget.config.mjs');
const KB = 1024;
const TOP_DEFAULT_ROWS = 5;

/** Raised for a build that cannot be measured (missing files, no entry). */
export class BundleCheckError extends Error {}

/** `name-AbCd12_-.js` → `name` (rolldown's 8-char base64url hash suffix). */
export function stableName(file) {
  return file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '');
}

export function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

/** `/assets/x.js` (or `./assets/x.js`) → `x.js`; anything else → null. */
function assetJs(ref) {
  const m = ref?.match(/^(?:\.?\/)?assets\/([^/?#]+\.js)(?:[?#].*)?$/);
  return m ? m[1] : null;
}

/**
 * Chunks index.html loads eagerly: the module entry script(s) and every
 * modulepreload link. External and inline scripts are ignored.
 */
export function parseIndexHtml(html) {
  let entry = null;
  const eager = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isScript = /^<script/i.test(tag);
    const isModule = isScript && attr(tag, 'type') === 'module';
    const isPreload = !isScript && attr(tag, 'rel') === 'modulepreload';
    const file = assetJs(attr(tag, isScript ? 'src' : 'href'));
    if (!file || !(isModule || isPreload)) continue;
    if (isModule && !entry) entry = file;
    eager.add(file);
  }
  return { entry, eager: [...eager] };
}

/** Map of `.js` asset filename → gzip-9 bytes (source maps skipped). */
export function measureAssets(assetsDir) {
  const sizes = new Map();
  for (const file of fs.readdirSync(assetsDir).sort()) {
    if (!file.endsWith('.js')) continue;
    sizes.set(file, gzipSize(fs.readFileSync(path.join(assetsDir, file))));
  }
  return sizes;
}

function readBuild(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(indexPath)) throw new BundleCheckError(`missing ${indexPath} — build web first`);
  if (!fs.existsSync(assetsDir)) throw new BundleCheckError(`missing ${assetsDir} — build web first`);
  const { entry, eager } = parseIndexHtml(fs.readFileSync(indexPath, 'utf8'));
  const sizes = measureAssets(assetsDir);
  if (sizes.size === 0) throw new BundleCheckError(`no .js chunks in ${assetsDir}`);
  if (!entry) throw new BundleCheckError(`no <script type="module"> asset in ${indexPath}`);
  const missing = eager.filter((f) => !sizes.has(f));
  if (missing.length) throw new BundleCheckError(`index.html references missing chunk(s): ${missing.join(', ')}`);
  return { entry, eager, sizes };
}

function lazyBudget(name, budgets) {
  const hit = (budgets.lazyOverrides ?? []).find(
    (o) => o.name === name || (o.pattern && o.pattern.test(name)),
  );
  return hit ? { kb: hit.budgetKB, named: hit } : { kb: budgets.lazyDefaultKB, named: null };
}

function row(chunk, cls, bytes, budgetKB, extra = {}) {
  return { chunk, cls, bytes, budgetKB, ok: bytes <= budgetKB * KB, ...extra };
}

function vendorRows(sizes, budgets) {
  const rows = [];
  for (const [group, budgetKB] of Object.entries(budgets.vendorGroupsKB ?? {})) {
    const files = [...sizes.keys()].filter((f) => stableName(f) === group);
    if (!files.length) continue;
    const bytes = files.reduce((sum, f) => sum + sizes.get(f), 0);
    const label = files.length > 1 ? `${group} [${files.length} files]` : files[0];
    rows.push(row(label, 'vendor', bytes, budgetKB, { files }));
  }
  return rows;
}

function chunkRows({ entry, eager, sizes }, budgets, vendorFiles) {
  const eagerSet = new Set(eager);
  const rows = [];
  for (const [file, bytes] of sizes) {
    if (file === entry || vendorFiles.has(file)) continue;
    const { kb, named } = lazyBudget(stableName(file), budgets);
    const cls = eagerSet.has(file) ? 'shared' : 'lazy';
    rows.push(row(file, cls, bytes, kb, { named }));
  }
  return rows.sort((a, b) => b.bytes - a.bytes);
}

function staleNotes(rows, budgets) {
  const used = new Set(rows.map((r) => r.named).filter(Boolean));
  const notes = (budgets.lazyOverrides ?? [])
    .filter((o) => !used.has(o))
    .map((o) => `budget entry "${o.name ?? o.label}" matched no chunk — renamed or removed? prune it`);
  const groups = new Set(rows.filter((r) => r.cls === 'vendor').map((r) => stableName(r.files[0])));
  for (const g of Object.keys(budgets.vendorGroupsKB ?? {})) {
    if (!groups.has(g)) notes.push(`vendor group "${g}" matched no chunk`);
  }
  return notes;
}

/**
 * Measure `distDir` against `budgets`. Returns `{ rows, eagerTotalBytes,
 * failures, notes }`; throws BundleCheckError when the build is unusable.
 */
export function checkBundle(distDir, budgets) {
  const build = readBuild(distDir);
  const { entry, eager, sizes } = build;
  const vendors = vendorRows(sizes, budgets);
  const vendorFiles = new Set(vendors.flatMap((r) => r.files));
  const chunks = chunkRows(build, budgets, vendorFiles);
  const eagerTotalBytes = eager.reduce((sum, f) => sum + sizes.get(f), 0);
  const rows = [
    row(entry, 'entry', sizes.get(entry), budgets.entryKB),
    ...vendors,
    ...chunks,
    row(`initial load [${eager.length} files]`, 'total', eagerTotalBytes, budgets.totalInitialKB),
  ];
  const failures = rows.filter((r) => !r.ok);
  return { rows, eagerTotalBytes, failures, notes: staleNotes(rows, budgets) };
}

const fmtKB = (bytes) => (bytes / KB).toFixed(1);

function headroom(r) {
  const diff = r.budgetKB * KB - r.bytes;
  if (diff < 0) return `OVER by ${fmtKB(-diff)} KB`;
  return `${fmtKB(diff)} KB (${Math.floor((diff / (r.budgetKB * KB)) * 100)}%)`;
}

function visibleRows(rows, all) {
  if (all) return rows;
  const isDefault = (r) => (r.cls === 'lazy' || r.cls === 'shared') && !r.named;
  const topDefault = new Set(rows.filter(isDefault).slice(0, TOP_DEFAULT_ROWS));
  return rows.filter((r) => !isDefault(r) || !r.ok || topDefault.has(r));
}

/** Render the result table as text (one line per visible row). */
export function formatTable(rows, { all = false } = {}) {
  const shown = visibleRows(rows, all);
  const cells = [['chunk', 'class', 'gzip KB', 'budget KB', 'headroom']];
  for (const r of shown) {
    cells.push([r.chunk, r.cls, fmtKB(r.bytes), r.budgetKB.toFixed(1), headroom(r)]);
  }
  const widths = cells[0].map((_, i) => Math.max(...cells.map((c) => c[i].length)));
  const lines = cells.map((c) => c.map((v, i) => (i >= 2 && i < 4 ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('  ').trimEnd());
  lines.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('  '));
  const hidden = rows.length - shown.length;
  if (hidden) lines.push(`… ${hidden} more chunk(s) within the default lazy cap (--all lists them)`);
  return lines.join('\n');
}

export function parseArgs(argv) {
  const opts = { dist: DEFAULT_DIST, config: DEFAULT_CONFIG, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if ((arg === '--dist' || arg === '--config') && argv[i + 1]) {
      opts[arg.slice(2)] = path.resolve(argv[i + 1]);
      i += 1;
    } else throw new BundleCheckError(`unknown or incomplete argument: ${arg}`);
  }
  return opts;
}

/** CLI entry: returns the process exit code (0 pass, 1 fail/error). */
export async function main(argv) {
  try {
    const opts = parseArgs(argv);
    const budgets = (await import(pathToFileURL(opts.config).href)).default;
    const result = checkBundle(opts.dist, budgets);
    console.log(`Bundle size budget — ${opts.dist} (gzip -9, KB = 1024 B)\n`);
    console.log(formatTable(result.rows, { all: opts.all }));
    for (const note of result.notes) console.log(`note: ${note}`);
    if (!result.failures.length) {
      console.log('\nPASS — every chunk is within budget.');
      return 0;
    }
    console.error(`\nFAIL — ${result.failures.length} over budget: ${result.failures.map((r) => r.chunk).join(', ')}`);
    console.error('Shrink the chunk, or raise its budget in scripts/bundle-budget.config.mjs and justify it in the PR.');
    return 1;
  } catch (err) {
    console.error(`bundle size check: ${err instanceof BundleCheckError ? err.message : err.stack}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
