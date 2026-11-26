/**
 * ROK-2292 — an event's forum post opens with the event's signup card: the
 * starter message has NO text, one embed (the event card) and the signup
 * button row, and it is created when the announcement is posted (D8), before
 * any signup. A signup then re-renders the starter's card (embed sync edits
 * the starter like the announcement).
 * Two paths: the event-planning forum post (bot-authored starter) and the
 * hub's bound forum (webhook starter — R2: proves Discord accepts components
 * on a webhook message). Bots cannot click buttons; the handlers stay in
 * integration tests. Both use the run's shared forum (`hub-forum-shared.ts`)
 * via `setup()`; posts are found by this test's unique event title;
 * `teardown()` deletes this test's event.
 */
import { createEvent } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { farOffTimes, setup, teardown, type Made } from "./hub-forum-discord-outbound.test.js";
import { expectResolvedForum } from "./event-planning-nonhub-event.test.js";
import { expectCardTracksSignup, expectStarterCard, postCreatedOnAnnounce } from "./forum-starter-card.helpers.js";

async function planningPostCard(ctx: TestContext): Promise<void> {
  const made: Made = {};
  try {
    const { forum, users } = await setup(ctx);
    await expectResolvedForum(ctx, forum.id);
    const event = await createEvent(ctx.api, "starter-card", farOffTimes());
    made.event = event.id;
    const post = await postCreatedOnAnnounce(forum, event.title);
    await expectStarterCard(post, event.id, event.title, "bot");
    await expectCardTracksSignup(ctx, post, event.id, users);
  } finally {
    await teardown(ctx, made);
  }
}

async function hubPostCard(ctx: TestContext): Promise<void> {
  const made: Made = {};
  try {
    const { forum, hub, gameId, users } = await setup(ctx);
    const event = await createEvent(ctx.api, "hub-starter-card", { guildId: hub, gameId, ...farOffTimes() });
    made.event = event.id;
    const post = await postCreatedOnAnnounce(forum, event.title);
    // R2: a webhook-authored starter carrying the signup buttons.
    await expectStarterCard(post, event.id, event.title, "webhook");
    await expectCardTracksSignup(ctx, post, event.id, users);
  } finally {
    await teardown(ctx, made);
  }
}

export const forumStarterCardTests: SmokeTest[] = [
  {
    name: "forum starter card: planning post opens with the event card on announce, tracks signups (ROK-2292)",
    category: "flow",
    serial: true,
    run: planningPostCard,
  },
  {
    name: "forum starter card: hub webhook post opens with the event card + buttons, tracks signups (ROK-2292 R2)",
    category: "flow",
    serial: true,
    run: hubPostCard,
  },
];
