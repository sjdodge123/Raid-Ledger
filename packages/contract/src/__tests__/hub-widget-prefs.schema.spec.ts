/**
 * ROK-1918 — hub Overview arrange mode: saved widget layout schemas, the
 * additive `GuildPage.widgetPrefs` key and the `hub` activity enums.
 */
import { describe, it, expect } from "vitest";
import {
  HUB_WIDGET_PREFS_MAX_CHARS,
  HUB_WIDGET_PREFS_MAX_IDS,
  HubTextWidgetConfigSchema,
  HubWidgetIdSchema,
  HubWidgetPrefsResponseSchema,
  HubWidgetPrefsSchema,
  UpdateHubWidgetPrefsSchema,
} from "../hub-widget-prefs.schema.js";
import { GuildPageSchema } from "../guilds.schema.js";
import {
  ActivityActionSchema,
  ActivityEntityTypeSchema,
} from "../activity-log.schema.js";

const prefs = {
  order: ["core:roster", "plugin:wow:raid-progress", "generic:text"],
  hidden: ["core:events"],
  added: ["generic:text"],
  config: { "generic:text": { title: "Rules", body: "**Be nice**" } },
};

const page = {
  guild: {
    id: 1,
    gameId: 2,
    kind: "wow_guild",
    name: "Gamer Saloon",
    region: "us",
    realmSlug: null,
    realmName: "Forever",
    faction: "Horde",
    memberCount: 12,
    lastSnapshotAt: null,
  },
  importedBy: null,
  viewer: { role: "visitor", canEdit: false, canManageEditors: false },
  ranks: [],
  roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const ids = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

describe("HubWidgetIdSchema", () => {
  it.each(["core:roster", "plugin:wow:raid-progress", "generic:text", "a"])(
    "accepts %s",
    (id) => expect(HubWidgetIdSchema.safeParse(id).success).toBe(true),
  );
  it.each(["", "Core:roster", ":lead", "has space", "x".repeat(121)])(
    "rejects %j",
    (id) => expect(HubWidgetIdSchema.safeParse(id).success).toBe(false),
  );
  it("accepts the 120-char maximum", () => {
    expect(HubWidgetIdSchema.safeParse("x".repeat(120)).success).toBe(true);
  });
});

describe("HubWidgetPrefsSchema", () => {
  it("round-trips a full layout", () => {
    expect(HubWidgetPrefsSchema.parse(prefs)).toEqual(prefs);
  });

  it("defaults a missing config to {}", () => {
    const parsed = HubWidgetPrefsSchema.parse({ order: [], hidden: [], added: [] });
    expect(parsed.config).toEqual({});
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(HubWidgetPrefsSchema.safeParse({ ...prefs, extra: 1 }).success).toBe(false);
  });

  it("rejects a missing list", () => {
    expect(HubWidgetPrefsSchema.safeParse({ order: [], hidden: [] }).success).toBe(false);
  });

  it.each(["order", "hidden", "added"] as const)("rejects duplicate ids in %s", (key) => {
    const result = HubWidgetPrefsSchema.safeParse({ ...prefs, [key]: ["a", "a"] });
    expect(result.error?.issues[0]?.message).toBe("Duplicate widget id");
  });

  it("accepts exactly the id cap and rejects one more", () => {
    const at = { order: ids(HUB_WIDGET_PREFS_MAX_IDS), hidden: [], added: [] };
    const over = { order: ids(HUB_WIDGET_PREFS_MAX_IDS + 1), hidden: [], added: [] };
    expect(HubWidgetPrefsSchema.safeParse(at).success).toBe(true);
    expect(HubWidgetPrefsSchema.safeParse(over).success).toBe(false);
  });

  it("rejects a layout over the serialised size cap", () => {
    const long = Array.from({ length: 3 }, (_, k) =>
      Array.from({ length: 50 }, (_, i) => `${"x".repeat(110)}${k}-${i}`),
    );
    const big = { order: long[0], hidden: long[1], added: long[2] };
    expect(JSON.stringify(big).length).toBeGreaterThan(HUB_WIDGET_PREFS_MAX_CHARS);
    const result = HubWidgetPrefsSchema.safeParse(big);
    expect(result.error?.issues[0]?.message).toMatch(/larger than 16384/);
  });

  it("rejects settings for a widget that takes none (plugin widgets, Q7)", () => {
    const result = HubWidgetPrefsSchema.safeParse({
      ...prefs,
      config: { "plugin:wow:raid-progress": { size: "lg" } },
    });
    expect(result.error?.issues[0]?.path).toEqual(["config", "plugin:wow:raid-progress"]);
  });

  it("validates generic:text settings against HubTextWidgetConfigSchema", () => {
    const result = HubWidgetPrefsSchema.safeParse({
      ...prefs,
      config: { "generic:text": { title: "x".repeat(61), body: "" } },
    });
    expect(result.error?.issues[0]?.path).toEqual(["config", "generic:text", "title"]);
  });

  // Codex P2: the schema lookup must not resolve inherited props
  // (`constructor` → Function → TypeError → API 500 instead of 400).
  it.each([
    ["constructor", { constructor: {} }],
    ["__proto__", JSON.parse('{"__proto__": {}}') as Record<string, unknown>],
    ["toString", JSON.parse('{"toString": {}}') as Record<string, unknown>],
  ])("rejects a config keyed %s without throwing", (_, config) => {
    let result: ReturnType<typeof HubWidgetPrefsSchema.safeParse> | undefined;
    expect(() => { result = HubWidgetPrefsSchema.safeParse({ ...prefs, config }); }).not.toThrow();
    expect(result?.success).toBe(false);
  });
});

describe("HubTextWidgetConfigSchema", () => {
  it("accepts the bounds and rejects past them", () => {
    const ok = { title: "x".repeat(60), body: "y".repeat(2000) };
    expect(HubTextWidgetConfigSchema.safeParse(ok).success).toBe(true);
    expect(HubTextWidgetConfigSchema.safeParse({ ...ok, body: "y".repeat(2001) }).success).toBe(false);
    expect(HubTextWidgetConfigSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe("UpdateHubWidgetPrefsSchema", () => {
  it("accepts a layout or { reset: true }", () => {
    expect(UpdateHubWidgetPrefsSchema.safeParse(prefs).success).toBe(true);
    expect(UpdateHubWidgetPrefsSchema.parse({ reset: true })).toEqual({ reset: true });
  });
  it.each([{ reset: false }, { reset: true, order: [] }, {}])("rejects %j", (body) => {
    expect(UpdateHubWidgetPrefsSchema.safeParse(body).success).toBe(false);
  });
});

describe("HubWidgetPrefsResponseSchema", () => {
  it("accepts stored prefs or null", () => {
    expect(HubWidgetPrefsResponseSchema.safeParse({ widgetPrefs: null }).success).toBe(true);
    expect(HubWidgetPrefsResponseSchema.safeParse({ widgetPrefs: prefs }).success).toBe(true);
  });
});

describe("GuildPageSchema.widgetPrefs (additive)", () => {
  it("parses an old payload without the key", () => {
    expect(GuildPageSchema.safeParse(page).success).toBe(true);
  });
  it("parses null and a saved layout", () => {
    expect(GuildPageSchema.safeParse({ ...page, widgetPrefs: null }).success).toBe(true);
    expect(GuildPageSchema.parse({ ...page, widgetPrefs: prefs }).widgetPrefs).toEqual(prefs);
  });
  it("rejects a malformed layout", () => {
    const bad = { ...page, widgetPrefs: { order: "nope" } };
    expect(GuildPageSchema.safeParse(bad).success).toBe(false);
  });
});

describe("activity enums", () => {
  it("know the hub entity and the layout action", () => {
    expect(ActivityEntityTypeSchema.parse("hub")).toBe("hub");
    expect(ActivityActionSchema.parse("hub_widget_layout_updated")).toBe(
      "hub_widget_layout_updated",
    );
  });
});
