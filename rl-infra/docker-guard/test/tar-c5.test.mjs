// ROK-1846 c5 — Go's archive/tar turns a legacy type-NUL (TypeRegA) header whose
// final name ends in `/` into a TypeDir: no body, whatever the size field says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTarScanner } from '../src/tar-scan.mjs';
import { dockerfileCandidates } from '../src/build-context.mjs';
import { tarOf, paxRecord } from './tar-fixture.mjs';

const ADD = 'FROM alpine\nADD http://127.0.0.1:2375/info /leak\n';
const scan = (entries) => {
  const s = createTarScanner(new Set(dockerfileCandidates(undefined)));
  s.push(tarOf(entries));
  return s.end();
};

test('a NUL-type dir/ header declaring 1024 bytes hides nothing (Codex c5 P1 sequence)', () => {
  const r = scan([
    { name: 'Dockerfile', data: 'FROM alpine\n' },
    { name: 'dir/', type: '\0', size: 1024 },
    { name: 'Dockerfile', data: ADD },
  ]);
  assert.match(r.error ?? '', /^build_context_ambiguous/);
});

test('the trailing-slash rule uses the PAX-resolved name', () => {
  const r = scan([
    { name: 'Dockerfile', data: 'FROM alpine\n' },
    { name: 'PaxHeaders/x', type: 'x', data: paxRecord('path', 'dir/') },
    { name: 'plain', type: '\0', size: 1024 },
    { name: 'Dockerfile', data: ADD },
  ]);
  assert.match(r.error ?? '', /^build_context_ambiguous/);
});

test('a NUL-type regular file (no trailing slash) still has its body', () => {
  const r = scan([{ name: 'a.txt', type: '\0', data: 'x'.repeat(700) }, { name: 'Dockerfile', type: '\0', data: 'FROM alpine\n' }]);
  assert.equal(r.error, null);
  assert.equal(r.files[0]?.data.toString(), 'FROM alpine\n');
});
