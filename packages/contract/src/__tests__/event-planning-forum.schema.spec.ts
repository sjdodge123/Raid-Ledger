/**
 * ROK-2272 — event-planning forum contract: settings DTO, tag names, the
 * generalised subject discussion (event aliases unchanged) and the optional
 * poll / lineup ids on a forum thread row. Every change here is additive.
 *
 * Runs under the contract workspace's own vitest config.
 */
import { describe, it, expect } from "vitest";
import {
  EVENT_PLANNING_TAGS,
  EventPlanningForumSettingsSchema,
  UpdateEventPlanningForumSchema,
} from "../event-planning-forum.schema.js";
import { SubjectDiscussionSchema } from "../subject-discussion.schema.js";
import {
  EventDiscussionSchema,
  EVENT_DISCUSSION_LATEST_MAX,
} from "../event-discussion.schema.js";
import { HubForumThreadSummarySchema } from "../hub-forum.schema.js";

const CHANNEL = "123456789012345678";
const ISO = "2026-11-20T02:00:00.000Z";

const settings = {
  channelId: CHANNEL,
  candidates: [{ channelId: CHANNEL, name: "event-planning", managed: true }],
  resolvedChannelId: CHANNEL,
};

const ready = {
  state: "ready" as const,
  guildId: 1,
  threadId: 2,
  replyCount: 0,
  latestReplies: [],
  lock: null,
  can: { read: true, reply: false },
};

const summary = {
  id: 1,
  title: "Poll thread",
  preview: "",
  author: null,
  createdAt: ISO,
  lastActivityAt: ISO,
  replyCount: 0,
  pinnedAt: null,
  deleted: null,
};

describe("EventPlanningForumSettingsSchema", () => {
  it("round-trips a settings payload, with and without a warning", () => {
    expect(EventPlanningForumSettingsSchema.parse(settings)).toEqual(settings);
    const warned = {
      ...settings,
      channelId: null,
      resolvedChannelId: null,
      warning: "Pick a forum",
    };
    expect(EventPlanningForumSettingsSchema.parse(warned)).toEqual(warned);
  });

  it("refuses a non-snowflake channel id and unknown keys", () => {
    const bad = { ...settings, channelId: "general" };
    expect(EventPlanningForumSettingsSchema.safeParse(bad).success).toBe(false);
    const extra = { ...settings, token: "x" };
    expect(EventPlanningForumSettingsSchema.safeParse(extra).success).toBe(
      false,
    );
  });

  it("accepts a pick or null as the update body", () => {
    expect(UpdateEventPlanningForumSchema.parse({ channelId: null })).toEqual({
      channelId: null,
    });
    expect(
      UpdateEventPlanningForumSchema.safeParse({ channelId: CHANNEL }).success,
    ).toBe(true);
  });

  it("names one tag per subject kind", () => {
    expect(EVENT_PLANNING_TAGS).toEqual({
      event: "Event",
      poll: "Poll",
      lineup: "Lineup",
    });
  });
});

describe("SubjectDiscussionSchema", () => {
  it("round-trips each kind and the kind-less event shape", () => {
    for (const kind of ["event", "poll", "lineup"] as const) {
      const v = { ...ready, kind };
      expect(SubjectDiscussionSchema.parse(v)).toEqual(v);
    }
    expect(SubjectDiscussionSchema.parse(ready)).toEqual(ready);
    expect(SubjectDiscussionSchema.parse({ state: "none" })).toEqual({
      state: "none",
    });
  });

  it("refuses an unknown kind", () => {
    const v = { ...ready, kind: "raid" };
    expect(SubjectDiscussionSchema.safeParse(v).success).toBe(false);
  });

  it("keeps the event exports as aliases", () => {
    expect(EventDiscussionSchema).toBe(SubjectDiscussionSchema);
    expect(EVENT_DISCUSSION_LATEST_MAX).toBe(3);
    expect(EventDiscussionSchema.parse(ready)).toEqual(ready);
  });
});

describe("HubForumThreadSummarySchema (ROK-2272 ids)", () => {
  it("accepts matchId / lineupId, null, or neither", () => {
    expect(HubForumThreadSummarySchema.parse(summary)).toEqual(summary);
    const poll = { ...summary, matchId: 7, lineupId: null };
    expect(HubForumThreadSummarySchema.parse(poll)).toEqual(poll);
    const lineup = { ...summary, lineupId: 9 };
    expect(HubForumThreadSummarySchema.parse(lineup)).toEqual(lineup);
  });
});
