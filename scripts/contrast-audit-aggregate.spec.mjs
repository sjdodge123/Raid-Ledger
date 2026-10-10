/**
 * node:test spec for scripts/smoke/contrast-audit.aggregate.mjs (ROK-1203).
 * Lives at scripts/ top level so `node --test scripts/*.spec.mjs` (validate-ci
 * --static + the GitHub CI node-spec step) runs it. Fixture: three JSONL files
 * in the shape contrast-audit.report.pw.ts writes, built in a temp dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    readRecords,
    selectorPrefix,
    summarize,
    renderReport,
    main,
} from './smoke/contrast-audit.aggregate.mjs';

const v = (selector, ratio, tokenHint, extra = {}) => ({
    selector, fg: '#777777', bg: '#ffffff', ratio, required: 4.5,
    text: 'Seeded text', tokenHint, component: null, ...extra,
});

const FIXTURE = {
    'default-light-desktop.jsonl': [
        { route: '/events', url: '/events', scheme: 'default-light', viewport: 'desktop', status: 'ok',
          violations: [v('.text-dim > span', 3.1, '--color-dim on --color-panel'),
              v('button.badge', 2.2, 'raw(#777777) on --color-surface', { component: 'event-card' })] },
        { route: '/players', url: '/players', scheme: 'default-light', viewport: 'desktop', status: 'ok',
          violations: [v('.text-dim', 4.1, '--color-dim on --color-panel')] },
    ],
    'default-dark-phone.jsonl': [
        { route: '/events/:id', url: '/events/7', scheme: 'default-dark', viewport: 'phone', status: 'redirect',
          finalUrl: '/events', violations: [] },
        { route: '/i/:code', scheme: 'default-dark', viewport: 'phone', status: 'skipped',
          reason: 'no invite fixture', violations: [] },
    ],
    'celestial-desktop.jsonl': [
        { route: '/games', url: '/games', scheme: 'celestial', viewport: 'desktop', status: 'timeout',
          reason: 'settle exceeded 20s', violations: [] },
    ],
};

function writeFixture() {
    const dir = mkdtempSync(path.join(tmpdir(), 'contrast-audit-'));
    for (const [name, records] of Object.entries(FIXTURE)) {
        writeFileSync(path.join(dir, name), `${records.map((r) => JSON.stringify(r)).join('\n')}\n\n`);
    }
    writeFileSync(path.join(dir, 'notes.txt'), 'not a jsonl file');
    return dir;
}

test('readRecords parses every line of every .jsonl file and ignores other files', () => {
    const records = readRecords(writeFixture());
    assert.equal(records.length, 5);
});

test('selectorPrefix keeps the first compound selector', () => {
    assert.equal(selectorPrefix('.text-dim > span'), '.text-dim');
    assert.equal(selectorPrefix('div:nth-child(3) span'), 'div:nth-child(3)');
    assert.equal(selectorPrefix('button.badge'), 'button.badge');
});

test('summarize counts per scheme/viewport cell', () => {
    const s = summarize(readRecords(writeFixture()));
    const light = s.cells.find((c) => c.scheme === 'default-light' && c.viewport === 'desktop');
    assert.deepEqual({ nodes: light.nodes, routes: light.routesWithViolations, ok: light.ok }, { nodes: 3, routes: 2, ok: 2 });
    const dark = s.cells.find((c) => c.scheme === 'default-dark');
    assert.deepEqual({ redirect: dark.redirect, skipped: dark.skipped }, { redirect: 1, skipped: 1 });
});

test('summarize groups by tokenHint, component and route, worst ratio first', () => {
    const s = summarize(readRecords(writeFixture()));
    assert.deepEqual(s.tokens[0], { key: '--color-dim on --color-panel', nodes: 2, routes: 2, minRatio: 3.1 });
    assert.deepEqual(s.components.map((c) => c.key).sort(), ['.text-dim', 'event-card']);
    assert.equal(s.components.find((c) => c.key === '.text-dim').nodes, 2);
    assert.equal(s.routes[0].route, '/events');
    assert.equal(s.routes[0].nodes, 2);
    assert.deepEqual(s.worst.map((w) => w.ratio), [2.2, 3.1, 4.1]);
    assert.deepEqual(s.problems.map((p) => p.status).sort(), ['redirect', 'skipped', 'timeout']);
});

test('renderReport has every section and main writes REPORT.md + summary.json', () => {
    const dir = writeFixture();
    const md = renderReport(summarize(readRecords(dir)));
    for (const heading of ['## Totals', '## By token pair', '## By component', '## By route', '## Worst 20', '## Redirects, skips, errors']) {
        assert.ok(md.includes(heading), `missing ${heading}`);
    }
    assert.ok(md.includes('| --color-dim on --color-panel | 2 | 2 | 3.1 |'));
    main([dir]);
    assert.ok(readFileSync(path.join(dir, 'REPORT.md'), 'utf8').startsWith('# Contrast audit'));
    assert.ok(existsSync(path.join(dir, 'summary.json')));
});
