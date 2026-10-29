// ROK-1846 c5 — the guard parses the raw query exactly as Go's url.ParseQuery
// does, and refuses (400 bad_request_target) anything the two could read differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/routes.mjs';
import { parseQuery } from '../src/query-parse.mjs';

const bad = (url, method = 'POST') => {
  const p = classify(method, url);
  assert.equal(p.ok, false, url);
  assert.equal(p.status, 400, url);
  assert.match(p.reason, /^bad_request_target/, url);
};

test('a raw # in the query is refused (Codex c5 P1 payload)', () => {
  bad('/build?x=#&t=rl-infra/gc-sweeper:latest');
  bad('/v1.45/build?networkmode=default#&networkmode=host');
});

test('a second ?, a ; separator, raw non-ASCII / control / space bytes are refused', () => {
  bad('/build?t=a?b');
  bad('/build?x=1;t=rl-infra/gc-sweeper:latest');
  bad('/build?t=ÿx');
  bad('/build?t=a b');
  bad('/build?t=a\tb');
});

test('%FF, a short / non-hex escape, %00 and %7F are refused', () => {
  bad('/build?dockerfile=%FF');
  bad('/build?dockerfile=%C3%BF');
  bad('/build?dockerfile=%2');
  bad('/build?dockerfile=%zz');
  bad('/build?dockerfile=a%00b');
  bad('/build?dockerfile=a%7Fb');
});

test('a repeated single-value key is refused; t= may repeat', () => {
  bad('/build?networkmode=default&networkmode=host');
  bad('/build?dockerfile=Dockerfile&dockerfile=evil');
  bad('/images/create?fromImage=alpine&fromImage=rl-infra/gc-sweeper');
  const ok = classify('POST', '/build?t=rl:ci-a&t=rl:ci-b');
  assert.equal(ok.ok, true);
  assert.equal(classify('POST', '/build?t=rl:ci-a&t=rl-infra/gc-sweeper:latest').ok, false);
});

test('decoding is exactly once, + and %20 both mean space, %2F means /', () => {
  const q = parseQuery('a=x+y&b=x%20y&c=sub%2FDockerfile&d=%252F&e&&f=');
  assert.equal(q.get('a'), 'x y');
  assert.equal(q.get('b'), 'x y');
  assert.equal(q.get('c'), 'sub/Dockerfile');
  assert.equal(q.get('d'), '%2F');
  assert.equal(q.get('e'), '');
  assert.equal(q.has('f'), true);
  assert.deepEqual(q.getAll('zz'), []);
  const p = classify('POST', '/build?dockerfile=sub%2FDockerfile&t=registry.rl.lan%3A5000%2Frl-allinone%3Aslug');
  assert.equal(p.ok, true);
  assert.equal(p.dockerfile, 'sub/Dockerfile');
  assert.equal(classify('POST', '/build?t=rl-infra%2Fgc-sweeper%3Alatest').ok, false);
});

test('dockerfile= must be printable ASCII with no .. segment', () => {
  bad('/build?dockerfile=..%2F..%2Fetc%2FDockerfile');
  bad('/build?dockerfile=a/../Dockerfile');
  bad('/build?dockerfile=%2e%2e/Dockerfile');
  assert.equal(classify('POST', '/build?dockerfile=docker/Dockerfile.ci').ok, true);
  assert.equal(classify('POST', '/build?dockerfile=a..b').ok, true);
});

test('ordinary runner queries still classify', () => {
  assert.equal(classify('GET', '/v1.45/containers/json?all=1&filters=%7B%22label%22%3A%5B%22x%22%5D%7D').ok, true);
  assert.equal(classify('POST', '/images/create?fromImage=redis&tag=7-alpine').ok, true);
});
