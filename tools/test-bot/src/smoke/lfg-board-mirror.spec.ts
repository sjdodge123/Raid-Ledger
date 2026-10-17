#!/usr/bin/env npx tsx
/**
 * ROK-1506 T30 — `assertReactionMirrored` fails with ITS OWN message.
 *
 * The companion smoke runs only on the fleet, so this pins the assertion's
 * shape on the laptop: a mirror that never carries the reaction, and one that
 * never drops it, must each fail by naming what the mirror held — not by a
 * bare `pollForCondition timed out`. Discord and the API are both faked.
 *
 * Run: npx tsx src/smoke/lfg-board-mirror.spec.ts
 */
import assert from "node:assert/strict";

import type { ApiClient } from "./api.js";
import type { ThreadMessageReactionSnapshot } from "./fixtures-lfg-board.js";
import {
  assertReactionMirrored,
  REACTION_EMOJI,
  type MirrorTarget,
  type ReactionPort,
} from "./tests/lfg-board.mirror.js";

const PROBE = { id: "111", content: "ROK-1483 mirror probe 1" };
const FIRE: ThreadMessageReactionSnapshot = {
  key: REACTION_EMOJI,
  name: REACTION_EMOJI,
  id: null,
  animated: false,
  count: 1,
};

/** A mirror whose reaction set is whatever the fake Discord last did. */
function fakeMirror(reactions: () => ThreadMessageReactionSnapshot[]) {
  const api = {
    get: async () => ({
      threadId: "222",
      threadUrl: null,
      messages: [
        {
          messageId: PROBE.id,
          author: { discordUserId: "333", displayName: "companion" },
          content: PROBE.content,
          reactions: reactions(),
        },
      ],
    }),
  } as unknown as ApiClient;
  const target: MirrorTarget = {
    api,
    threadId: "222",
    gameId: 7,
    forumChannelId: "444",
    timeoutMs: 300,
    trackProbe: () => {},
  };
  return target;
}

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(err)}`);
  }
}

await test("green: react lands as {key, count: 1}, un-react clears it", async () => {
  let live: ThreadMessageReactionSnapshot[] = [];
  const port: ReactionPort = {
    react: async () => {
      live = [FIRE];
    },
    unreact: async () => {
      live = [];
    },
  };
  await assertReactionMirrored(fakeMirror(() => live), PROBE, port);
});

await test("red: mirror never carries the reaction -> T30 names what it held", async () => {
  const port: ReactionPort = { react: async () => {}, unreact: async () => {} };
  await assert.rejects(
    assertReactionMirrored(fakeMirror(() => []), PROBE, port),
    (err: Error) => {
      assert.match(
        err.message,
        /^T30: the companion bot reacted 🔥 to "ROK-1483 mirror probe 1" \(111\) in thread 222, but GET \/discord\/threads\/222\/messages never carried \{key: "🔥", count: 1\} on it — the mirror held no reactions$/,
      );
      return true;
    },
  );
});

await test("red: a 0-count pill lingers after un-react -> T30 names the pill", async () => {
  let live: ThreadMessageReactionSnapshot[] = [];
  const port: ReactionPort = {
    react: async () => {
      live = [FIRE];
    },
    unreact: async () => {
      live = [{ ...FIRE, count: 0 }];
    },
  };
  await assert.rejects(
    assertReactionMirrored(fakeMirror(() => live), PROBE, port),
    (err: Error) => {
      assert.match(
        err.message,
        /^T30: the companion bot removed its 🔥 from "ROK-1483 mirror probe 1" \(111\) in thread 222, but the mirror still carries it — a removed reaction must disappear, never linger as a 0-count pill \(D7\); the mirror held \{key: "🔥", name: "🔥", count: 0\}$/,
      );
      return true;
    },
  );
});

await test("red: a doubled count is not count 1", async () => {
  const port: ReactionPort = { react: async () => {}, unreact: async () => {} };
  await assert.rejects(
    assertReactionMirrored(fakeMirror(() => [{ ...FIRE, count: 2 }]), PROBE, port),
    (err: Error) => {
      assert.match(err.message, /never carried \{key: "🔥", count: 1\} on it — the mirror held \{key: "🔥", name: "🔥", count: 2\}$/);
      return true;
    },
  );
});

console.log(`\n${String(passed)} passed, ${String(failed)} failed`);
process.exit(failed > 0 ? 1 : 0);
