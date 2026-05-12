/**
 * ROK-1264 — pin every supertest call to a single keep-alive pooled socket.
 *
 * **STATUS (2026-05-12): available but NOT wired in `test-app.ts`.** Applying
 * this wrapper globally with `maxSockets: 1` provably eliminates the H4
 * loopback-bleed carrier in `lineups-voting.integration.spec.ts` (0/50 hits
 * post-fix vs 1/20 pre-fix), BUT deterministically breaks any spec that
 * fans out parallel HTTP requests via `Promise.all`. Specifically
 * `events.integration.spec.ts › GET /events/:id/detail (ROK-1046) ›
 * shape parity per slice vs legacy endpoints` failed 10/10 in isolation
 * because `fetchLegacySlices` queues 5 parallel requests through one socket,
 * one of which (`/voice-channel`) does a DB+Discord lookup that exceeds
 * supertest's default response timeout when serialized.
 *
 * Intermediate `maxSockets` values were tested: `:1` (events.spec 10/10 fail),
 * `:2` (events.spec 3/3 fail, ~5× wallclock blowup), `:5` (events.spec passes
 * 3/3, but lineups-voting carrier returns to ~4% — statistically equivalent
 * to the 5% pre-fix baseline). No single `maxSockets` value satisfies both
 * hard-serialization (needed for H4) AND parallel-friendly (needed for
 * `fetchLegacySlices`). See `docs/spikes/rok-1250-residual-layer-5.md`.
 *
 * The helper + spec are retained so any future opt-in deployment (per-file
 * annotation, per-test-scope reset, etc.) has ready-to-use machinery and a
 * deterministic regression gate. Do NOT wire globally without re-validating
 * against the full integration suite.
 *
 *
 * Mechanism (architecture-v2 §3 H4 + Tier-1 probe-1 reproducer 2026-05-12):
 *   The 'Parse Error: Expected HTTP/, RTSP/ or ICE/' (and 'socket hang up')
 *   class fires CLIENT-SIDE inside superagent's llhttp parser when sequential
 *   supertest requests in the same `it()` race the loopback driver. Server
 *   socket events never fire on these failures (instrumentHttpServer
 *   confirms). Sub-mechanism: the prior request's response stream tail bytes
 *   leak onto the next request's NEW socket — supertest's per-request
 *   `agent: false` default gives every request a fresh ephemeral port with
 *   no serialization barrier between FIN-flush and next connect.
 *
 *   Forcing `agent: keepAlive=true, maxSockets=1` makes ALL calls share ONE
 *   long-lived socket. The agent's request queue serializes per-socket; each
 *   request awaits the prior response's full drain before writing the next.
 *   No cross-socket bleed possible because there is only one socket.
 *
 * Why this is NOT the falsified ROK-1264 H2 fix:
 *   The H2 fix set `_options.agent` on the TestAgent FACTORY, which supertest
 *   does NOT plumb to per-request `Test._agent`. Each Test starts with
 *   `_agent = false` regardless of factory options. See
 *   `supertest-keepalive.spec.ts` for the falsification proof. This wrapper
 *   instead sets `_agent` on each `Test` instance via `Test.agent(myAgent)`,
 *   which IS honored — `superagent/lib/node/index.js:736` reads
 *   `options.agent = this._agent` per request.
 */
import * as http from 'http';
import type * as supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
] as const;

const PERSISTENT_AGENT_KEY = Symbol('rok-1264-persistent-agent');

interface AgentHolder {
  [PERSISTENT_AGENT_KEY]?: http.Agent;
}

/**
 * Wrap a supertest TestAgent so every request method pins the returned
 * `Test`'s underlying http.Agent to a single keep-alive pooled agent
 * (`maxSockets: 1`). Idempotent — re-wrapping is a no-op.
 */
export function wrapWithPersistentAgent(
  agent: TestAgent<supertest.Test>,
): TestAgent<supertest.Test> {
  const holder = agent as unknown as AgentHolder;
  if (holder[PERSISTENT_AGENT_KEY]) return agent;
  const persistent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  holder[PERSISTENT_AGENT_KEY] = persistent;
  for (const method of HTTP_METHODS) {
    const slot = agent as unknown as Record<
      string,
      (...args: unknown[]) => supertest.Test
    >;
    const orig = slot[method].bind(agent);
    slot[method] = (...args: unknown[]) => orig(...args).agent(persistent);
  }
  return agent;
}

/** Destroy the persistent agent's pooled socket; safe if never wrapped. */
export function destroyPersistentAgent(agent: TestAgent<supertest.Test>): void {
  const holder = agent as unknown as AgentHolder;
  const persistent = holder[PERSISTENT_AGENT_KEY];
  if (persistent) {
    persistent.destroy();
    delete holder[PERSISTENT_AGENT_KEY];
  }
}
