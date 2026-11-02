#!/usr/bin/env node
// ROK-1900 L7 — one-shot migration helper for the interim pending-approval folder.
//
// Reads planning-artifacts/pending-approval/ (pass the MAIN checkout path) and, for
// each item still PENDING in INDEX.md, emits a payload shaped like the
// `rl_approval_submit` tool input (tools/mcp-rl-fleet/src/tools/approval.ts).
// Operator ruling Q5: migrate pending items only; `_approved/` stays on disk.
//
// DRY-RUN ONLY: prints JSON, never submits. The Lead submits each payload with the
// rl_approval_submit MCP tool after the dashboard is deployed.
//
// Usage: node scripts/pending-approval-export.mjs <pending-approval-dir> [--compact]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMG = /\.(png|jpe?g|webp)$/i;
const REC = /\*{0,2}_?Rec(?:ommendation)?s?_?\s*:\s*\*{0,2}/i;
const strip = (s) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

/** Rows of the `## Pending` table in INDEX.md (stops at the next `##` heading). */
export function parsePendingRows(indexText) {
  const rows = [];
  let inPending = false;
  for (const line of indexText.split('\n')) {
    if (/^##\s/.test(line)) inPending = /^##\s+Pending\b/i.test(line);
    if (!inPending || !line.startsWith('|')) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((c) => c.trim());
    if (cells.length < 4 || /^-+$/.test(cells[0] ?? '') || /^Item$/i.test(cells[0] ?? '')) continue;
    rows.push({ item: cells[0], decide: cells[1], where: cells[2], since: cells[3] });
  }
  return rows;
}

/** Numbered questions of an ITEM.md with their "Rec:" recommendations. */
export function parseQuestions(itemText) {
  const blocks = [];
  let prevBlank = true;
  for (const raw of itemText.split('\n')) {
    const m = /^\s{0,3}(\d+)\.\s+(.*)$/.exec(raw);
    if (m) blocks.push([m[2]]);
    else if (/^#/.test(raw)) blocks.push(null);
    else if (raw.trim() === '') { prevBlank = true; continue; }
    else if (blocks.at(-1) && (!prevBlank || /^\s+/.test(raw))) blocks.at(-1).push(raw.trim());
    else blocks.push(null);
    prevBlank = false;
  }
  return blocks.filter(Boolean).map((parts) => {
    const text = parts.join(' ');
    const m = REC.exec(text);
    const question = strip((m ? text.slice(0, m.index) : text).replace(/[\s—–-]+$/, ''));
    const recommendation = m ? strip(text.slice(m.index + m[0].length)) : '';
    return { text: question, recommendation };
  });
}

function findFolder(root, where) {
  for (const m of where.matchAll(/`([^`\s/]+)\/[^`]*`/g)) {
    if (m[1] !== 'specs' && existsSync(join(root, m[1]))) return m[1];
  }
  return null;
}

function findSpec(root, folderAbs, where, warnings) {
  const named = /`(specs\/[^`\s]+\.md)/.exec(where);
  if (named) {
    const p = resolve(dirname(root), named[1]);
    if (existsSync(p)) return p;
    warnings.push(`spec ${named[1]} not found next to the pending-approval dir`);
    return undefined;
  }
  if (!folderAbs) return undefined;
  const md = readdirSync(folderAbs).filter((f) => f.endsWith('.md') && f !== 'ITEM.md').sort();
  return md[0] ? join(folderAbs, md[0]) : undefined;
}

/** Build one submit payload from an INDEX row. */
export function buildItem(root, row) {
  const warnings = [];
  const title = strip(row.item);
  const folder = findFolder(root, row.where);
  const folderAbs = folder ? join(root, folder) : null;
  const story = /ROK-\d+/.exec(title)?.[0] ?? (folder ? basename(folder) : title);
  const files = folderAbs ? readdirSync(folderAbs) : [];
  const mockup = files.includes('mockup.html') ? join(folderAbs, 'mockup.html') : undefined;
  const shots = files.filter((f) => IMG.test(f)).sort().map((f) => join(folderAbs, f));
  const specPath = findSpec(root, folderAbs, row.where, warnings);
  let questions = [];
  if (folderAbs && existsSync(join(folderAbs, 'ITEM.md'))) {
    questions = parseQuestions(readFileSync(join(folderAbs, 'ITEM.md'), 'utf8'));
  } else {
    warnings.push('no ITEM.md folder: questions live in the spec; the Lead must write them by hand');
  }
  if (questions.length === 0) warnings.push('no numbered questions parsed');
  questions.forEach((q, i) => { if (!q.recommendation) warnings.push(`question ${i + 1} has no "Rec:" recommendation`); });
  const kind = mockup ? 'mockup' : /\bspike\b/i.test(title) ? 'spike' : 'ruling';
  const payload = {
    story, title, kind, summary: strip(row.decide), questions,
    ...(mockup ? { mockup_path: mockup } : {}),
    ...(shots.length ? { screenshot_paths: shots } : {}),
    ...(specPath ? { spec_path: specPath } : {}),
  };
  return { source: { since: strip(row.since), folder }, payload, warnings };
}

export function exportPending(dir) {
  const root = resolve(dir);
  const rows = parsePendingRows(readFileSync(join(root, 'INDEX.md'), 'utf8'));
  return { dry_run: true, source_dir: root, count: rows.length, items: rows.map((r) => buildItem(root, r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node scripts/pending-approval-export.mjs <pending-approval-dir> [--compact]');
    process.exit(2);
  }
  console.log(JSON.stringify(exportPending(dir), null, args.includes('--compact') ? 0 : 2));
}
