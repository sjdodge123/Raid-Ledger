#!/usr/bin/env npx tsx
/**
 * ROK-1740 — the join-post smoke reserves its channel before the binding
 * pool, so a pool that would take every non-default channel cannot leave it
 * with nowhere to post (the smoke then threw on every CI run). ROK-1788: two
 * channels are reserved, one per concurrent lease slot (`SMOKE_POOL_INDEX`).
 */
import assert from "node:assert/strict";
import {
  foreignJoinPostChannelIds,
  pickJoinPostChannel,
  poolCandidateChannels,
  quickPlayReservedChannels,
  reservedJoinPostChannels,
} from "./join-post-channel.js";
import { smokePoolIndex } from "./pool-index.js";
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

test("reserves the last two non-default text channels, slot 0 first", () => {
  const ids = reservedJoinPostChannels(CHANNELS, "default").map((c) => c.id);
  assert.deepEqual(ids, ["c", "b"]);
});

test("index 0 picks the last non-default text channel (as before ROK-1788)", () => {
  assert.equal(pickJoinPostChannel(CHANNELS, "default", 0)?.id, "c");
});

test("index 1 picks the second-to-last, so concurrent runs never share", () => {
  assert.equal(pickJoinPostChannel(CHANNELS, "default", 1)?.id, "b");
});

test("an unset SMOKE_POOL_INDEX picks the index-0 channel", () => {
  const index = smokePoolIndex({});
  assert.equal(pickJoinPostChannel(CHANNELS, "default", index)?.id, "c");
});

test("an out-of-range index wraps like the voice rotation", () => {
  assert.equal(pickJoinPostChannel(CHANNELS, "default", 2)?.id, "c");
  assert.equal(pickJoinPostChannel(CHANNELS, "default", 3)?.id, "b");
});

test("a guild with one usable channel gives every index that channel", () => {
  const one = [ch("default", 0), ch("voice", 2), ch("solo", 0)];
  assert.equal(pickJoinPostChannel(one, "default", 0)?.id, "solo");
  assert.equal(pickJoinPostChannel(one, "default", 1)?.id, "solo");
  assert.deepEqual([...foreignJoinPostChannelIds(one, "default", 1)], []);
  assert.deepEqual(poolCandidateChannels(one, "default").map((c) => c.id), ["voice"]);
});

test("never picks the default or a non-text channel", () => {
  const only = [ch("default", 0), ch("voice", 2)];
  assert.equal(pickJoinPostChannel(only, "default", 0), null);
  assert.equal(pickJoinPostChannel(only, "default", 1), null);
});

test("each slot sees only the OTHER slot's channel as foreign", () => {
  assert.deepEqual([...foreignJoinPostChannelIds(CHANNELS, "default", 0)], ["b"]);
  assert.deepEqual([...foreignJoinPostChannelIds(CHANNELS, "default", 1)], ["c"]);
});

test("the pool gets no join-post or Quick Play reserved channel", () => {
  // 4 usable: join-post pair (f, e), Quick Play pair (d, c) → pool [a, b].
  const six = [ch("default", 0), ...["a", "b", "c", "d", "e", "f"].map((id) => ch(id, 0))];
  assert.deepEqual(reservedJoinPostChannels(six, "default").map((c) => c.id), ["f", "e"]);
  assert.deepEqual(quickPlayReservedChannels(six, "default").map((c) => c.id), ["c", "d"]);
  assert.deepEqual(poolCandidateChannels(six, "default").map((c) => c.id), ["a", "b"]);
  // A small guild spares Quick Play what it can; the pool gets nothing.
  assert.deepEqual(quickPlayReservedChannels(CHANNELS, "default").map((c) => c.id), ["a"]);
  assert.deepEqual(poolCandidateChannels(CHANNELS, "default"), []);
});

test("the pool is empty when there is nothing left to bind", () => {
  assert.deepEqual(poolCandidateChannels([ch("default", 0)], "default"), []);
  const two = [ch("default", 0), ch("a", 0), ch("b", 0)];
  assert.deepEqual(poolCandidateChannels(two, "default"), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
