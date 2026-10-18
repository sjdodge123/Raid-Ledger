// ROK-1846 c5 — every FROM / COPY --from names an image the image policy allows:
// no infra or slot-built (rl / rl-allinone) image, nothing outside the public
// allowlist unless pinned by digest, and no /build?pull=1 with such a base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerfileReason } from '../src/dockerfile-policy.mjs';
import { classify } from '../src/routes.mjs';

const D = '@sha256:' + 'a'.repeat(64);
const refuse = (df, opts, re) => assert.match(dockerfileReason(df, opts) ?? '', re, df);

test('FROM an infra service image is refused, with or without pull (Codex c5 P1)', () => {
  for (const img of ['rl-infra/gc-sweeper:latest', 'rl-infra/docker-guard', 'wollomatic/socket-proxy:1', 'traefik:v3.4', 'grafana/loki:3.2.0', `rl-infra/gc-sweeper${D}`]) {
    refuse(`FROM ${img}\nRUN true\n`, {}, /infra service image/);
    refuse(`FROM ${img}\n`, { pull: true }, /infra service image/);
  }
});

test('FROM / COPY --from of a slot-built rl / rl-allinone image is refused', () => {
  for (const img of ['rl:ci-test', 'registry.rl.lan:5000/rl-allinone:slug', 'rl-allinone:latest', 'evil.io/rl-infra/x:1']) {
    refuse(`FROM ${img}\n`, {}, /slot-built|infra service image/);
    refuse(`FROM alpine\nCOPY --from=${img} /a /b\n`, {}, /slot-built|infra service image/);
  }
});

test('a base outside the public allowlist must be digest-pinned, and never with pull=1', () => {
  refuse('FROM evil.io/attacker/base:1\n', {}, /digest/);
  refuse('FROM attacker/base\n', {}, /digest/);
  refuse('FROM node:22\nCOPY --from=attacker/onbuild:1 /x /y\n', {}, /digest/);
  assert.equal(dockerfileReason(`FROM attacker/base${D}\n`, {}), null);
  refuse(`FROM attacker/base${D}\n`, { pull: true }, /pull/);
});

test('variable or quoted FROM images and ONBUILD-hidden lines are refused', () => {
  refuse('ARG B=rl-infra/gc-sweeper\nFROM $B\n', {}, /variable/);
  refuse('FROM "rl-infra/gc-sweeper"\n', {}, /plain/);
  refuse('FROM --platform=linux/amd64 rl-infra/gc-sweeper AS x\n', {}, /infra/);
  refuse('RUN echo \\\nFROM rl-infra/gc-sweeper\n', {}, /infra/);
});

test('public bases, stages, scratch and pull=1 on them pass', () => {
  const df = 'FROM debian:bookworm-slim AS donor\nFROM node:22-alpine AS deps\nFROM deps AS builder\nFROM --platform=$BUILDPLATFORM nginx:alpine\nCOPY --from=builder /a /b\nCOPY --from=0 /a /b\nFROM scratch\nFROM mcr.microsoft.com/playwright:v1.64.1-jammy\nFROM pgvector/pgvector:pg16\n';
  assert.equal(dockerfileReason(df, {}), null);
  assert.equal(dockerfileReason(df, { pull: true }), null);
});

test('/build?pull= is read as Docker BoolValue', () => {
  assert.equal(classify('POST', '/build?pull=1').pull, true);
  assert.equal(classify('POST', '/build?pull=true').pull, true);
  assert.equal(classify('POST', '/build?pull=0').pull, false);
  assert.equal(classify('POST', '/build').pull, false);
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

test('every Dockerfile in the repo passes the whole policy, with pull=1 too', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const f of repoDockerfiles(root)) {
    assert.equal(dockerfileReason(fs.readFileSync(f), { pull: true }), null, f);
  }
});
