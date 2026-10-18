// ROK-1846 c3 — Codex round 3: BuildKit's standalone-escape continuation rule
// and Go's replace-not-merge handling of consecutive PAX headers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerfileReason } from '../src/dockerfile-policy.mjs';
import { createTarScanner } from '../src/tar-scan.mjs';
import { dockerfileCandidates } from '../src/build-context.mjs';
import { paxRecord, tarOf } from './tar-fixture.mjs';

const LEAK = 'FROM alpine\nADD http://127.0.0.1:2375/info /leak\n';
const scan = (entries) => {
  const s = createTarScanner(new Set(dockerfileCandidates(undefined)));
  s.push(tarOf(entries));
  return s.end();
};

test('a lone escape line continues the instruction (Codex c3 P1 sequence is refused)', () => {
  const df = 'FROM alpine\nRUN true \\\\\nAD\\\nD \\\n\\\nhttp://127.0.0.1:2375/info /leak\n';
  assert.match(dockerfileReason(df) ?? '', /remote source/);
  const bt = '# escape=`\nFROM alpine\nRUN true ``\nAD`\nD `\n`\nhttp://127.0.0.1:2375/info /leak\n';
  assert.match(dockerfileReason(bt) ?? '', /remote source/);
});

test('the dockerfile-ast instruction stream is a reading (ONBUILD-nested included)', () => {
  assert.notEqual(dockerfileReason('FROM a\nONBUILD ADD ["http://x/y", "/z"]\n'), null);
  assert.notEqual(dockerfileReason('FROM a\nONBUILD COPY --from=rl-infra/orchestrator / /\n'), null);
  assert.equal(dockerfileReason('FROM a AS b\nFROM c\nCOPY --from=b /x /y\nADD local.tgz /srv/\n'), null);
});

test('a later PAX header replaces the pending one (Codex c3 P1 sequence is ambiguous)', () => {
  const r = scan([
    { name: 'Dockerfile', data: 'FROM alpine\n' },
    { name: 'PaxHeader', type: 'x', data: paxRecord('path', 'innocent') },
    { name: 'PaxHeader', type: 'x', data: paxRecord('path', '') },
    { name: 'Dockerfile', data: LEAK },
  ]);
  assert.match(r.error ?? '', /^build_context_ambiguous/);
});

test('a later PAX header without path drops an earlier path override', () => {
  const r = scan([
    { name: 'PaxHeader', type: 'x', data: paxRecord('path', 'innocent') },
    { name: 'PaxHeader', type: 'x', data: paxRecord('mtime', '1') },
    { name: 'Dockerfile', data: LEAK },
  ]);
  assert.equal(r.error, null);
  assert.equal(r.files[0]?.data.toString(), LEAK);
});
