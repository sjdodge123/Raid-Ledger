#!/usr/bin/env node
/* ROK-1527 WIP — shortest non-weak retainer path from the GC root to target
 * nodes in a V8 .heapsnapshot. Streams the numeric arrays out of a Buffer so
 * snapshots larger than V8's max string length still parse.
 * Usage: node --max-old-space-size=8000 scripts/heap-retainer-path.cjs <file> [name ...]
 * Default targets: NestApplication. Also resolves `rl-probe-file-N` tag strings
 * to the object that holds them. */
'use strict';
const fs = require('fs');
const file = process.argv[2];
const extra = process.argv.slice(3);
const buf = fs.readFileSync(file);

function parseIntArray(key, count) {
  let i = buf.indexOf(`"${key}":[`) + key.length + 4;
  const out = new Float64Array(count);
  let n = 0, cur = 0, inNum = false;
  for (; n < count && i < buf.length; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) { cur = cur * 10 + (c - 48); inNum = true; }
    else if (inNum) { out[n++] = cur; cur = 0; inNum = false; if (c === 93) break; }
    else if (c === 93) break;
  }
  if (inNum && n < count) out[n++] = cur;
  if (n !== count) throw new Error(`${key}: parsed ${n} of ${count}`);
  return out;
}

const headEnd = buf.indexOf('"nodes":[');
const head = buf.slice(0, headEnd).toString().trim().replace(/^\{"snapshot":/, '').replace(/,$/, '');
const snap = JSON.parse(head);
const meta = snap.meta;
const NF = meta.node_fields.length, EF = meta.edge_fields.length;
const nodeTypes = meta.node_types[0], edgeTypes = meta.edge_types[0];
const nodes = parseIntArray('nodes', snap.node_count * NF);
const edges = parseIntArray('edges', snap.edge_count * EF);
const sStart = buf.indexOf('"strings":[') + 10;
const strings = JSON.parse(buf.slice(sStart, buf.lastIndexOf(']') + 1).toString());
const nT = meta.node_fields.indexOf('type'), nN = meta.node_fields.indexOf('name');
const nE = meta.node_fields.indexOf('edge_count'), nS = meta.node_fields.indexOf('self_size');
const eT = meta.edge_fields.indexOf('type'), eN = meta.edge_fields.indexOf('name_or_index');
const eTo = meta.edge_fields.indexOf('to_node');
const N = snap.node_count;
const firstEdge = new Float64Array(N + 1);
for (let k = 0; k < N; k++) firstEdge[k + 1] = firstEdge[k] + nodes[k * NF + nE] * EF;
const name = (k) => strings[nodes[k * NF + nN]];
const ntype = (k) => nodeTypes[nodes[k * NF + nT]];
function edgeLabel(e) {
  const t = edgeTypes[edges[e + eT]];
  const v = edges[e + eN];
  return t === 'element' || t === 'hidden' ? `${t}[${v}]` : `${t}:${strings[v]}`;
}
const SKIP = new Set(['weak_refs_keep_during_job', ...(process.env.SKIP_EDGES || '').split(',').filter(Boolean)]);
// BFS from root (node 0) over non-weak edges → shortest retainer path.
const parentEdge = new Float64Array(N).fill(-1);
const parentNode = new Int32Array(N).fill(-1);
const seen = new Uint8Array(N);
const queue = new Int32Array(N);
let qh = 0, qt = 0;
queue[qt++] = 0; seen[0] = 1;
while (qh < qt) {
  const k = queue[qh++];
  for (let e = firstEdge[k]; e < firstEdge[k + 1]; e += EF) {
    const t = edgeTypes[edges[e + eT]];
    if (t === 'weak' || t === 'shortcut') continue;
    if (t !== 'element' && t !== 'hidden' && SKIP.has(strings[edges[e + eN]])) continue;
    const to = edges[e + eTo] / NF;
    if (seen[to]) continue;
    seen[to] = 1; parentEdge[to] = e; parentNode[to] = k; queue[qt++] = to;
  }
}
function pathTo(k) {
  if (!seen[k]) return '  (unreachable via strong edges)';
  const steps = [];
  for (let c = k; c > 0; c = parentNode[c]) {
    steps.push(`  <- [${edgeLabel(parentEdge[c])}] of ${ntype(parentNode[c])} "${String(name(parentNode[c])).slice(0, 90)}" @${nodes[parentNode[c] * NF + 2]}`);
  }
  return steps.join('\n');
}
const targets = new Set(['NestApplication', 'NestContainer', ...extra]);
const counts = {};
const hits = [];
for (let k = 0; k < N; k++) {
  const nm = name(k);
  if (ntype(k) === 'object' && targets.has(nm)) { counts[nm] = (counts[nm] || 0) + 1; hits.push(k); }
  if (ntype(k) === 'string' && /^rl-probe-file-\d+$/.test(nm)) hits.push(k);
  if (ntype(k) === 'hidden' && nm === 'system / NativeContext') counts.NativeContext = (counts.NativeContext || 0) + 1;
}
console.log('counts', JSON.stringify(counts), 'nodes', N);
const AUTO_DUMP = Number(process.env.AUTO_DUMP || 0);
function dumpNode(k, max) {
  console.log(`  === dump @${nodes[k * NF + 2]} ${ntype(k)} "${String(name(k)).slice(0, 90)}"`);
  let i = 0;
  for (let e = firstEdge[k]; e < firstEdge[k + 1] && i < max; e += EF, i++) {
    const to = edges[e + eTo] / NF;
    console.log(`    ${edgeLabel(e)} -> ${ntype(to)} "${String(name(to)).slice(0, 120)}" @${nodes[to * NF + 2]}`);
  }
}
for (const k of hits.slice(0, 12)) {
  console.log(`\n### ${ntype(k)} "${name(k)}" id=${nodes[k * NF + 2]} self=${nodes[k * NF + nS]}`);
  console.log(pathTo(k));
  if (AUTO_DUMP && seen[k]) {
    const chain = [];
    for (let c = k; c > 0; c = parentNode[c]) chain.push(parentNode[c]);
    for (const c of chain.slice(-AUTO_DUMP - 1, -1)) dumpNode(c, 40);
  }
}

// DUMP_IDS=id,id → one level of outgoing edges (strings/numbers shown inline).
const idIndex = new Map();
const want = new Set((process.env.DUMP_IDS || '').split(',').filter(Boolean).map(Number));
if (want.size) for (let k = 0; k < N; k++) if (want.has(nodes[k * NF + 2])) idIndex.set(nodes[k * NF + 2], k);
for (const [id, k] of idIndex) {
  console.log(`\n=== dump @${id} ${ntype(k)} "${name(k)}"`);
  for (let e = firstEdge[k]; e < firstEdge[k + 1]; e += EF) {
    const to = edges[e + eTo] / NF;
    const v = String(name(to)).slice(0, 120);
    console.log(`  ${edgeLabel(e)} -> ${ntype(to)} "${v}" @${nodes[to * NF + 2]}`);
  }
}

// TIMERS=1 → every strongly-reachable Timeout: its _onTimeout owner
// (function name + script + line via the snapshot's `locations`), grouped,
// plus whether its async-context store reaches a jest describeBlock.
if (process.env.TIMERS) {
  const LF = (meta.location_fields || []).length;
  const locByNode = new Map();
  if (LF) {
    let i = buf.indexOf('"locations":[') + 13;
    const vals = [];
    let cur = 0, inNum = false;
    for (; i < buf.length; i++) {
      const c = buf[i];
      if (c >= 48 && c <= 57) { cur = cur * 10 + (c - 48); inNum = true; }
      else if (inNum) { vals.push(cur); cur = 0; inNum = false; if (c === 93) break; }
      else if (c === 93) break;
    }
    for (let j = 0; j + LF <= vals.length; j += LF) locByNode.set(vals[j] / NF, [vals[j + 1], vals[j + 2] + 1, vals[j + 3]]);
  }
  const edgeTo = (k, label) => {
    for (let e = firstEdge[k]; e < firstEdge[k + 1]; e += EF) {
      const t = edgeTypes[edges[e + eT]];
      if (t !== 'element' && t !== 'hidden' && strings[edges[e + eN]] === label) return edges[e + eTo] / NF;
    }
    return -1;
  };
  const edgeToMatch = (k, re) => {
    for (let e = firstEdge[k]; e < firstEdge[k + 1]; e += EF) {
      const t = edgeTypes[edges[e + eT]];
      if (t !== 'element' && t !== 'hidden' && re.test(strings[edges[e + eN]])) return edges[e + eTo] / NF;
    }
    return -1;
  };
  function describeFn(f) {
    if (f < 0) return '(none)';
    let s = `${ntype(f)} "${name(f)}"`;
    const tgt = edgeTo(f, 'bound_function') >= 0 ? edgeTo(f, 'bound_function') : edgeTo(f, 'bound_target_function');
    if (tgt >= 0) {
      const bt = edgeTo(f, 'bound_this');
      s += ` bound(this=${bt >= 0 ? ntype(bt) + ' "' + name(bt) + '"' : '?'}) -> ${describeFn(tgt)}`;
      return s;
    }
    const sh = edgeTo(f, 'shared');
    const scr = sh >= 0 ? edgeTo(sh, 'script') : -1;
    const sn = scr >= 0 ? (edgeTo(scr, 'name') >= 0 ? name(edgeTo(scr, 'name')) : name(scr)) : '?';
    const loc = locByNode.get(f);
    return `${s} @ ${String(sn).slice(-110)}:${loc ? loc[1] + ':' + loc[2] : '?'}`;
  }
  // Does the Timeout's async store lead (≤4 hops) to a describeBlock?
  function storeHasDescribe(t) {
    const st = edgeToMatch(t, /kResourceStore|AsyncContextFrame/i);
    if (st < 0) return 'no-store';
    const q = [[st, 0]]; const vis = new Set([st]);
    while (q.length) {
      const [k, d] = q.shift();
      for (let e = firstEdge[k]; e < firstEdge[k + 1]; e += EF) {
        const t2 = edgeTypes[edges[e + eT]];
        if (t2 === 'weak') continue;
        const lbl = t2 === 'element' || t2 === 'hidden' ? '' : strings[edges[e + eN]];
        if (lbl === 'describeBlock' || lbl === 'parent' && name(edges[e + eTo] / NF) === 'Object' && d > 0) return `store->${lbl}@depth${d}`;
        const to = edges[e + eTo] / NF;
        if (d < 6 && !vis.has(to)) { vis.add(to); q.push([to, d + 1]); }
      }
    }
    return 'store(no describeBlock)';
  }
  const groups = new Map();
  for (let k = 0; k < N; k++) {
    if (ntype(k) !== 'object' || name(k) !== 'Timeout' || !seen[k]) continue;
    const key = `${describeFn(edgeTo(k, '_onTimeout'))} | ${storeHasDescribe(k)}`;
    const g = groups.get(key) || { n: 0, ids: [] };
    g.n++; if (g.ids.length < 3) g.ids.push(nodes[k * NF + 2]);
    groups.set(key, g);
  }
  console.log('\n=== TIMERS (strongly reachable Timeout objects, grouped by _onTimeout)');
  for (const [key, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) console.log(`  x${g.n} ${key} ids=${g.ids.join(',')}`);
  for (const k of hits.slice(0, 12)) {
    for (let c = k; c > 0; c = parentNode[c]) {
      if (name(c) === 'Timeout' && ntype(c) === 'object') { console.log(`\n=== chain Timeout for hit @${nodes[k * NF + 2]}:`); dumpNode(c, 30); console.log('  _onTimeout: ' + describeFn(edgeTo(c, '_onTimeout'))); break; }
    }
  }
}
