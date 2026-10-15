#!/usr/bin/env npx tsx
/**
 * ROK-1740 — the join-post smoke reserves its channel before the binding
 * pool, so a pool that would take every non-default channel cannot leave it
 * with nowhere to post (the smoke then threw on every CI run).
 */
import assert from "node:assert/strict";
import {
  pickJoinPostChannel,
  poolCandidateChannels,
} from "./join-post-channel.js";
import type { DiscordChannel } from "./types.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${String(err)}`);
  }
}

const ch = (id: string, type?: number): DiscordChannel => ({
  id,
  name: id,
  ...(type !== undefined && { type }),
});
const CHANNELS = [ch("default", 0), ch("a", 0), ch("b", 0), ch("c", 0)];

test("picks the last non-default text channel", () => {
  assert.equal(pickJoinPostChannel(CHANNELS, "default")?.id, "c");
});

test("never picks the default or a non-text channel", () => {
  const only = [ch("default", 0), ch("voice", 2)];
  assert.equal(pickJoinPostChannel(only, "default"), null);
});

test("the pool never gets the join-post channel, even with games to spare", () => {
  const pool = poolCandidateChannels(CHANNELS, "default").map((c) => c.id);
  assert.deepEqual(pool, ["a", "b"]);
});

test("the pool keeps every channel when there is nothing to reserve", () => {
  const pool = poolCandidateChannels([ch("default", 0)], "default");
  assert.deepEqual(pool, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
