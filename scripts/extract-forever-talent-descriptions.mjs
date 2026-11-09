#!/usr/bin/env node
/**
 * ROK-2150: add per-rank tooltip text and the calculator hash version to the static
 * WoW: Forever talent table (`web/src/plugins/wow/lib/talent-data/forever-trees.json`).
 *
 * Forever reuses one spell id for every rank of a talent, so Wowhead's spell tooltip
 * cannot show per-rank values. Wowhead's Forever calculator data carries the per-rank
 * text instead. Save it from
 *   https://nether.wowhead.com/forever/data/talents-classic?dv=34&db=<build>
 * (a `WH.setPageData("wow.talentCalcClassic.classicplus.data", {...})` script) and run:
 *
 *   node scripts/extract-forever-talent-descriptions.mjs <path-to-saved-data.js>
 *
 * Every existing talent is matched by tree + row + col and its name checked; any
 * unmatched talent, rank-count mismatch or ambiguous tree fails the run (exit 1)
 * without writing. Descriptions are stored as PLAIN TEXT (never HTML). The warrior
 * spec fixture (`__fixtures__/forever-warrior-trees.json`) is rewritten to match.
 * Node built-ins only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE_PATH = path.join(ROOT, 'web/src/plugins/wow/lib/talent-data/forever-trees.json');
const FIXTURE_PATH = path.join(ROOT, 'web/src/plugins/wow/lib/__fixtures__/forever-warrior-trees.json');
const PAGE_DATA_KEY = 'wow.talentCalcClassic.classicplus.data';

function fail(message) {
    console.error(`extract-forever-talent-descriptions: ${message}`);
    process.exit(1);
}

/** The JSON argument of the `WH.setPageData("<key>", {...});` line. */
function readCalculatorData(file) {
    const prefix = `WH.setPageData(${JSON.stringify(PAGE_DATA_KEY)},`;
    const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(prefix));
    if (!line) fail(`no ${prefix} line in ${file}`);
    const body = line.slice(prefix.length, line.lastIndexOf(')'));
    const data = JSON.parse(body);
    if (typeof data.hashVersion !== 'string' || !data.hashVersion) fail('data has no hashVersion');
    if (typeof data.talents !== 'object' || typeof data.trees !== 'object') fail('data has no talents/trees');
    return data;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === '#') {
            const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
        }
        return ENTITIES[code.toLowerCase()] ?? whole;
    });
}

/** Wowhead tooltip HTML → plain text: line breaks kept, markup and comment markers dropped. */
export function toPlainText(html) {
    const text = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(tr|table|p|div)\b[^>]*>/gi, '\n')
        .replace(/<\/(td|th)>/gi, ' ')
        .replace(/<[^>]*>/g, '');
    const lines = decodeEntities(text).split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** "WarriorProtection" etc. per class: Wowhead tree ids whose description starts with the class. */
function classTreeIds(data, classSlug) {
    return Object.values(data.trees)
        .filter((t) => typeof t.description === 'string' && t.description.toLowerCase().startsWith(classSlug))
        .map((t) => String(t.id));
}

function normalise(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Our tree ↔ the one Wowhead tree of the class where every talent matches by row + col + name. */
function findWowheadTree(data, classSlug, tree) {
    const candidates = classTreeIds(data, classSlug).filter((id) => {
        const talents = Object.values(data.talents[id] ?? {});
        return tree.talents.every((t) =>
            talents.some((w) => w.row === t.row && w.col === t.col && normalise(w.name) === normalise(t.name)));
    });
    if (candidates.length !== 1) fail(`${classSlug}/${tree.name}: ${candidates.length} Wowhead trees match (want 1)`);
    return data.talents[candidates[0]];
}

function descriptionsFor(classSlug, treeName, talent, wowhead) {
    const where = `${classSlug}/${treeName}/${talent.name} (${talent.row},${talent.col})`;
    const match = Object.values(wowhead).find((w) => w.row === talent.row && w.col === talent.col);
    if (!match) fail(`${where}: no Wowhead talent at that cell`);
    if (normalise(match.name) !== normalise(talent.name)) fail(`${where}: Wowhead names it "${match.name}"`);
    const descriptions = [];
    for (let rank = 1; rank <= talent.maxRank; rank += 1) {
        const html = match.descriptions?.[String(rank)];
        if (typeof html !== 'string' || !html.trim()) fail(`${where}: no rank ${rank} description`);
        const text = toPlainText(html);
        if (/[<>]/.test(text)) fail(`${where}: rank ${rank} still has markup: ${text}`);
        descriptions.push(text);
    }
    if (match.descriptions?.[String(talent.maxRank + 1)] !== undefined) fail(`${where}: Wowhead has more ranks than ${talent.maxRank}`);
    return descriptions;
}

function extract(table, data) {
    const out = {};
    for (const [classSlug, entry] of Object.entries(table)) {
        const trees = entry.trees.map((tree) => {
            const wowhead = findWowheadTree(data, classSlug, tree);
            const talents = tree.talents.map(({ descriptions: _old, ...talent }) =>
                ({ ...talent, descriptions: descriptionsFor(classSlug, tree.name, talent, wowhead) }));
            return { name: tree.name, talents };
        });
        out[classSlug] = { hashVersion: data.hashVersion, trees };
    }
    return out;
}

function main() {
    const file = process.argv[2];
    if (!file) fail('usage: node scripts/extract-forever-talent-descriptions.mjs <wowhead-talents-data.js>');
    const data = readCalculatorData(file);
    const table = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
    const out = extract(table, data);
    fs.writeFileSync(TABLE_PATH, `${JSON.stringify(out, null, 2)}\n`);
    fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify({ warrior: out.warrior }, null, 1)}\n`);
    const count = Object.values(out).flatMap((c) => c.trees).reduce((n, t) => n + t.talents.length, 0);
    console.log(`wrote ${count} talents (hashVersion ${data.hashVersion}) to ${path.relative(ROOT, TABLE_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
