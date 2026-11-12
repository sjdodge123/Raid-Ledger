import { describe, expect, it } from "vitest";
import {
  GUILD_PAST_EVENTS_PAGE_SIZE,
  GuildPastEventsPageSchema,
  GuildPastEventsQuerySchema,
} from "./index.js";

/** ROK-2185 item 3 — past-events paging: the page body and the cursor query. */
const CARD = {
  id: 7,
  title: "Molten Core",
  startTime: "2026-10-01T19:00:00.000Z",
  signedUp: 12,
  attended: null,
};

describe("GuildPastEventsPageSchema", () => {
  it("accepts recent-shaped cards and a cursor", () => {
    const page = { events: [CARD], nextCursor: "abc" };
    expect(GuildPastEventsPageSchema.parse(page)).toEqual(page);
  });

  it("accepts a null cursor on the last page", () => {
    const page = { events: [], nextCursor: null };
    expect(GuildPastEventsPageSchema.safeParse(page).success).toBe(true);
  });

  it("rejects a page longer than the fixed page size", () => {
    const events = Array.from(
      { length: GUILD_PAST_EVENTS_PAGE_SIZE + 1 },
      (_, i) => ({ ...CARD, id: i + 1 }),
    );
    const res = GuildPastEventsPageSchema.safeParse({ events, nextCursor: null });
    expect(res.success).toBe(false);
  });

  it("rejects an empty-string cursor", () => {
    const res = GuildPastEventsPageSchema.safeParse({ events: [], nextCursor: "" });
    expect(res.success).toBe(false);
  });
});

describe("GuildPastEventsQuerySchema", () => {
  it("treats the cursor as optional", () => {
    expect(GuildPastEventsQuerySchema.parse({})).toEqual({});
  });

  it("rejects an empty or oversized cursor", () => {
    expect(GuildPastEventsQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
    const huge = "x".repeat(201);
    expect(GuildPastEventsQuerySchema.safeParse({ cursor: huge }).success).toBe(false);
  });

  it("pins the page size at 20 (operator ruling Q4 = A)", () => {
    expect(GUILD_PAST_EVENTS_PAGE_SIZE).toBe(20);
  });
});
