#!/usr/bin/env node
/**
 * ROK-1203 contrast-audit aggregator (plain Node, no deps).
 *
 *   node scripts/smoke/contrast-audit.aggregate.mjs [dir]
 *
 * Reads every `*.jsonl` under `dir` (default `test-results/contrast-audit`),
 * one record per line in the shape contrast-audit.report.pw.ts appends, and
 * writes `REPORT.md` + `summary.json` beside them: totals per scheme x
 * viewport, a per-token-pair fix list, per-component and per-route tables,
 * the 20 worst ratios, and every redirect / skip / timeout / error.
 * Spec: scripts/contrast-audit-aggregate.spec.mjs.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DIR = 'test-results/contrast-audit';
const STATUSES = ['ok', 'redirect', 'skipped', 'timeout', 'error'];

/** Every record from every `*.jsonl` file in `dir`; blank lines are skipped. */
export function readRecords(dir) {
    return readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .flatMap((name) => readFileSync(path.join(dir, name), 'utf8').split('\n'))
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
}

/** The first compound selector of an axe target (`.a > b` -> `.a`). */
export function selectorPrefix(selector) {
    return String(selector).trim().split(/\s*[\s>+~]\s*/)[0] ?? '';
}

/** One flat row per violating node, carrying its cell. */
function flatten(records) {
    return records.flatMap((r) => (r.violations ?? []).map((v) => ({
        ...v, route: r.route, scheme: r.scheme, viewport: r.viewport,
    })));
}

/** Group `rows` by `keyOf`: node count, distinct routes, worst (lowest) ratio. */
function groupBy(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        const g = groups.get(key) ?? { key, nodes: 0, routeSet: new Set(), minRatio: Infinity };
        g.nodes += 1;
        g.routeSet.add(row.route);
        g.minRatio = Math.min(g.minRatio, Number(row.ratio ?? Infinity));
        groups.set(key, g);
    }
    return [...groups.values()]
        .map(({ routeSet, ...g }) => ({ ...g, routes: routeSet.size }))
        .sort((a, b) => b.nodes - a.nodes || a.minRatio - b.minRatio);
}

/** Totals per scheme x viewport cell: statuses, violating nodes, routes affected. */
function cellTotals(records) {
    const cells = new Map();
    for (const r of records) {
        const key = `${r.scheme}|${r.viewport}`;
        const c = cells.get(key) ?? { scheme: r.scheme, viewport: r.viewport, nodes: 0, routeSet: new Set(),
            ...Object.fromEntries(STATUSES.map((s) => [s, 0])) };
        c[r.status] = (c[r.status] ?? 0) + 1;
        const n = (r.violations ?? []).length;
        c.nodes += n;
        if (n > 0) c.routeSet.add(r.route);
        cells.set(key, c);
    }
    return [...cells.values()]
        .map(({ routeSet, ...c }) => ({ ...c, routesWithViolations: routeSet.size }))
        .sort((a, b) => `${a.scheme}|${a.viewport}`.localeCompare(`${b.scheme}|${b.viewport}`));
}

/** Per-route node totals and the cells (scheme/viewport) that produced them. */
function routeTotals(rows) {
    return groupBy(rows, (row) => row.route).map((g) => ({
        route: g.key, nodes: g.nodes, minRatio: g.minRatio,
        cells: [...new Set(rows.filter((r) => r.route === g.key).map((r) => `${r.scheme}/${r.viewport}`))].sort(),
    }));
}

/** Everything the report renders, as plain data (also written to summary.json). */
export function summarize(records) {
    const rows = flatten(records);
    return {
        records: records.length,
        cells: cellTotals(records),
        tokens: groupBy(rows, (row) => row.tokenHint ?? 'unmapped'),
        components: groupBy(rows, (row) => row.component ?? selectorPrefix(row.selector)),
        routes: routeTotals(rows),
        worst: [...rows].sort((a, b) => Number(a.ratio) - Number(b.ratio)).slice(0, 20),
        problems: records.filter((r) => r.status !== 'ok').map((r) => ({
            route: r.route, scheme: r.scheme, viewport: r.viewport, status: r.status,
            detail: r.reason ?? r.finalUrl ?? '',
        })),
    };
}

/** Escape a value for a markdown table cell. */
function cell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** A markdown table; `rows` are arrays of cell values. */
function table(headers, rows) {
    if (rows.length === 0) return '_none_\n';
    const lines = [headers, headers.map(() => '---'), ...rows.map((r) => r.map(cell))];
    return `${lines.map((l) => `| ${l.join(' | ')} |`).join('\n')}\n`;
}

const groupTable = (groups, label) => table([label, 'nodes', 'routes', 'min ratio'],
    groups.map((g) => [g.key, g.nodes, g.routes, g.minRatio]));

/** Render the summary as REPORT.md. */
export function renderReport(s) {
    return [
        '# Contrast audit (ROK-1203)\n',
        `${s.records} cells scanned with axe \`color-contrast\` (whole page, no exclude). Phone = 375x812 under the`,
        'desktop project (desktop UA); layout breakpoints are width-driven. Report-only: nothing here gates CI.\n',
        '## Totals\n',
        table(['scheme', 'viewport', 'nodes', 'routes w/ violations', ...STATUSES],
            s.cells.map((c) => [c.scheme, c.viewport, c.nodes, c.routesWithViolations, ...STATUSES.map((k) => c[k])])),
        '## By token pair (the fix list — one token fix clears every node in its row)\n',
        groupTable(s.tokens, 'fg on bg'),
        '## By component (nearest data-testid, else first selector compound)\n',
        groupTable(s.components, 'component'),
        '## By route\n',
        table(['route', 'nodes', 'min ratio', 'cells'], s.routes.map((r) => [r.route, r.nodes, r.minRatio, r.cells.join(', ')])),
        '## Worst 20 ratios\n',
        table(['ratio', 'needs', 'route', 'scheme', 'viewport', 'selector', 'fg', 'bg', 'token hint', 'text'],
            s.worst.map((w) => [w.ratio, w.required, w.route, w.scheme, w.viewport, w.selector, w.fg, w.bg, w.tokenHint, w.text])),
        '## Redirects, skips, errors\n',
        table(['route', 'scheme', 'viewport', 'status', 'detail'],
            s.problems.map((p) => [p.route, p.scheme, p.viewport, p.status, p.detail])),
    ].join('\n');
}

/** CLI entry: aggregate `argv[0]` (or the default dir) into REPORT.md + summary.json. */
export function main(argv = process.argv.slice(2)) {
    const dir = argv[0] ?? DEFAULT_DIR;
    const summary = summarize(readRecords(dir));
    writeFileSync(path.join(dir, 'REPORT.md'), renderReport(summary));
    writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const s = main();
    console.log(`contrast audit: ${s.records} cells -> REPORT.md + summary.json`);
}
