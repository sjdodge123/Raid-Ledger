// ROK-1846 c4 — Codex round 4: Unicode whitespace BuildKit trims (U+0085 etc.)
// and Go's archive/tar ignoring the size field of body-less entry types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerfileReason } from '../src/dockerfile-policy.mjs';
import { createTarScanner } from '../src/tar-scan.mjs';
import { dockerfileCandidates } from '../src/build-context.mjs';
import { tarOf } from './tar-fixture.mjs';

const ADD = 'ADD http://127.0.0.1:2375/info /leak\n';
const scan = (entries) => {
  const s = createTarScanner(new Set(dockerfileCandidates(undefined)));
  s.push(tarOf(entries));
  return s.end();
};

test('a U+0085 / NBSP / zero-width / RTL-override prefix is refused non_ascii (Codex c4 P1)', () => {
  for (const ch of ['\u0085', ' ', '​', '‮', ' ', '\u0001', '\u007f', '﻿']) {
    assert.match(dockerfileReason(`FROM alpine\n${ch}${ADD}`) ?? '', /^non_ascii/, JSON.stringify(ch));
  }
  assert.match(dockerfileReason(Buffer.from(`FROM alpine\n\u0085${ADD}`)) ?? '', /^non_ascii/);
});

test('an NBSP inside a comment is refused; invalid UTF-8 bytes are refused', () => {
  assert.match(dockerfileReason('# note here\nFROM alpine\n') ?? '', /^non_ascii/);
  assert.match(dockerfileReason(Buffer.from([0x46, 0x52, 0x4f, 0x4d, 0x20, 0xc3, 0x0a])) ?? '', /^non_ascii/);
});

test('a UTF-8 BOM at byte 0 only is stripped and accepted (string and bytes)', () => {
  assert.equal(dockerfileReason('﻿FROM alpine\r\nRUN true\tx\n'), null);
  assert.equal(dockerfileReason(Buffer.from('﻿FROM alpine\nRUN true\n')), null);
});

function repoDockerfiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) repoDockerfiles(p, out);
    else if (/^Dockerfile(\..*)?$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every Dockerfile in the repo is ASCII (the guard would accept its bytes)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const files = repoDockerfiles(root);
  assert.ok(files.length >= 5, `found ${files.length} Dockerfiles`);
  for (const f of files) assert.doesNotMatch(dockerfileReason(fs.readFileSync(f)) ?? '', /^non_ascii/, f);
});

test('a directory header declaring size 1024 has no body (Codex c4 P1 sequence is ambiguous)', () => {
  const r = scan([
    { name: 'Dockerfile', data: 'FROM alpine\n' },
    { name: 'dir/', type: '5', size: 1024 },
    { name: 'Dockerfile', data: `FROM alpine\n${ADD}` },
  ]);
  assert.match(r.error ?? '', /^build_context_ambiguous/);
});

test('a symlink declaring size 42 has no body; the following Dockerfile is scanned', () => {
  const r = scan([{ name: 'link', type: '2', size: 42 }, { name: 'Dockerfile', data: 'FROM alpine\n' }]);
  assert.equal(r.error, null);
  assert.deepEqual(r.files.map((f) => [f.name, f.data.toString()]), [['Dockerfile', 'FROM alpine\n']]);
  for (const type of ['1', '3', '4', '6']) {
    const t = scan([{ name: 'x', type, size: 600 }, { name: 'Dockerfile', data: 'FROM a\n' }]);
    assert.equal(t.files[0]?.data.toString(), 'FROM a\n', type);
  }
});

test('sparse and other unmodelled entry types are refused', () => {
  for (const type of ['S', 'D', 'M', 'N', 'V', 'Z']) {
    const r = scan([{ name: 'x', type, data: 'abc' }, { name: 'Dockerfile', data: 'FROM a\n' }]);
    assert.match(r.error ?? '', /not inspected/, type);
  }
});
