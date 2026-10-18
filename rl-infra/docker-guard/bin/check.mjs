#!/usr/bin/env node
// ROK-1846 — offline policy probe for the shell tests (no Docker needed).
// stdin: {"method":"POST","url":"/v1.45/containers/create","body":{...}}
// stdout: ALLOW | DENY <reason>; exit 0 on allow, 1 on deny, 2 on bad input.
import { parseBindAllow } from '../src/body-policy.mjs';
import { classify } from '../src/routes.mjs';
import { checkBody } from '../src/decide.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  process.stdout.write('BAD-INPUT\n');
  process.exit(2);
}
const plan = classify(String(input.method), String(input.url));
let verdict = plan.ok ? { ok: true } : plan;
if (plan.ok && plan.body) {
  const ctx = { allow: parseBindAllow(process.env.GUARD_BIND_ALLOW), owner: { owner: 'slot-1', slot: '1' } };
  verdict = checkBody(plan.body, input.body ?? {}, ctx);
}
process.stdout.write(verdict.ok ? 'ALLOW\n' : `DENY ${verdict.reason}\n`);
process.exit(verdict.ok ? 0 : 1);
