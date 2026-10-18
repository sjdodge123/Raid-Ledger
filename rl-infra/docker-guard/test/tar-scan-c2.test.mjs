// ROK-1846 c2 — the scanner resolves names as Go's archive/tar does (an empty
// PAX/GNU value keeps the ustar name) and refuses any ambiguous Dockerfile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTarScanner } from '../src/tar-scan.mjs';
import { dockerfileCandidates } from '../src/build-context.mjs';
import { paxRecord, tarOf } from './tar-fixture.mjs';

const LEAK = 'FROM alpine\nADD http://127.0.0.1:2375/info /leak\n';
const PLAIN = 'FROM alpine\n';
const scan = (entries, param) => {
  const s = createTarScanner(new Set(dockerfileCandidates(param)));
  s.push(tarOf(entries));
  return s.end();
};

test('the Codex sequence — dockerfile, empty PAX path, Dockerfile — is build_context_ambiguous', () => {
  const r = scan([{ name: 'dockerfile', data: PLAIN }, { name: 'PaxHeader', type: 'x', data: paxRecord('path', '') }, { name: 'Dockerfile', data: LEAK }]);
  assert.match(r.error ?? '', /^build_context_ambiguous/);
});

test('an empty PAX path keeps the ustar name', () => {
  const r = scan([{ name: 'PaxHeader', type: 'x', data: paxRecord('path', '') }, { name: 'Dockerfile', data: LEAK }]);
  assert.equal(r.error, null);
  assert.equal(r.files[0]?.data.toString(), LEAK);
});

test('duplicates, case, ./ and trailing-slash variants are ambiguous', () => {
  for (const entries of [
    [{ name: 'Dockerfile', data: PLAIN }, { name: 'Dockerfile', data: LEAK }],
    [{ name: 'Dockerfile', data: PLAIN }, { name: './Dockerfile', data: LEAK }],
    [{ name: 'Dockerfile', data: PLAIN }, { name: 'DOCKERFILE', data: LEAK }],
    [{ name: 'Dockerfile/', type: '5' }],
    [{ name: './Dockerfile', data: PLAIN }],
  ]) assert.match(scan(entries).error ?? '', /^build_context_ambiguous/, JSON.stringify(entries.map((e) => e.name)));
  assert.match(scan([{ name: 'docker/Df', data: PLAIN }, { name: 'docker/DF', data: LEAK }], 'docker/Df').error ?? '', /^build_context_ambiguous/);
});

test('a normal context and a GNU long name pass', () => {
  assert.equal(scan([{ name: 'Dockerfile', data: PLAIN }, { name: 'src/a.js', data: 'x' }]).error, null);
  const long = `${'d/'.repeat(60)}Dockerfile`;
  const r = scan([{ name: '././@LongLink', type: 'L', data: `${long}\0` }, { name: 'trunc', data: PLAIN }], long);
  assert.equal(r.error, null);
  assert.equal(r.files.length, 1);
  const empty = scan([{ name: '././@LongLink', type: 'L', data: '\0' }, { name: 'Dockerfile', data: PLAIN }]);
  assert.equal(empty.files.length, 1);
});
