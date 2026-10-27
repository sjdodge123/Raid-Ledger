import { z } from "zod";

/**
 * ROK-1918 — per-hub Overview layout ("arrange mode"): saved order, hidden
 * default-on widgets, added opt-in widgets and per-widget settings. Stored
 * whole as `guild_profiles.widget_prefs` (jsonb); `null` = registry default.
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

/** Max ids in any one list (order / hidden / added). */
export const HUB_WIDGET_PREFS_MAX_IDS = 64;
/** Max serialised size of a whole prefs object, in JSON characters. */
export const HUB_WIDGET_PREFS_MAX_CHARS = 16_384;
export const HUB_TEXT_WIDGET_TITLE_MAX = 60;
export const HUB_TEXT_WIDGET_BODY_MAX = 2000;

/** A widget id — the Overview `Cell.key` string (core, module, plugin, generic). */
export const HubWidgetIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9:_-]{0,119}$/, "Invalid widget id");
export type HubWidgetId = z.infer<typeof HubWidgetIdSchema>;

/** Core generic widgets (Q5): all default OFF, registered by core. */
export const HUB_GENERIC_WIDGET_IDS = [
  "generic:countdown",
  "generic:links",
  "generic:text",
] as const;
export const HubGenericWidgetIdSchema = z.enum(HUB_GENERIC_WIDGET_IDS);
export type HubGenericWidgetId = z.infer<typeof HubGenericWidgetIdSchema>;

/** Settings for the `generic:text` widget (markdown body). */
export const HubTextWidgetConfigSchema = z
  .object({
    title: z.string().max(HUB_TEXT_WIDGET_TITLE_MAX),
    body: z.string().max(HUB_TEXT_WIDGET_BODY_MAX),
  })
  .strict();
export type HubTextWidgetConfig = z.infer<typeof HubTextWidgetConfigSchema>;

/**
 * The only widgets that accept `config` in v1. Plugin widgets get none (Q7):
 * the API cannot see web-side plugin schemas, so any other key is rejected.
 */
/**
 * A `Map`, not an object literal: a lookup by a user-supplied key must never
 * resolve an inherited prop (`config: { constructor: {} }` found
 * `Object.prototype.constructor` and threw — an API 500, not a 400).
 */
const CONFIG_SCHEMAS: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  ["generic:text", HubTextWidgetConfigSchema],
]);
export const HUB_CONFIGURABLE_WIDGET_IDS = [...CONFIG_SCHEMAS.keys()];

/**
 * An own `__proto__` key (`JSON.parse` makes one) is rejected outright: zod's
 * record parser silently drops it, which would turn a hostile body into a
 * quiet 200 instead of the 400 every other unknown widget id gets.
 */
function hasNoProtoKey(value: unknown): boolean {
  return (
    typeof value !== "object" ||
    value === null ||
    !Object.prototype.hasOwnProperty.call(value, "__proto__")
  );
}

const idList = z
  .array(HubWidgetIdSchema)
  .max(HUB_WIDGET_PREFS_MAX_IDS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Duplicate widget id",
  });

function checkConfig(
  config: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const [key, value] of Object.entries(config)) {
    const schema = CONFIG_SCHEMAS.get(key);
    if (!schema) {
      ctx.addIssue({
        code: "custom",
        path: ["config", key],
        message: "Widget does not accept settings",
      });
      continue;
    }
    const parsed = schema.safeParse(value);
    for (const issue of parsed.error?.issues ?? []) {
      ctx.addIssue({
        code: "custom",
        path: ["config", key, ...issue.path],
        message: issue.message,
      });
    }
  }
}

export const HubWidgetPrefsSchema = z
  .object({
    /** Saved relative order of known ids. */
    order: idList,
    /** Default-on widgets the hub turned off. */
    hidden: idList,
    /** Default-OFF (opt-in) widgets the hub turned on. */
    added: idList,
    /** Per-widget settings, keyed by widget id (generic widgets only in v1). */
    config: z
      .custom<Record<string, unknown>>(hasNoProtoKey, {
        message: "Widget does not accept settings",
      })
      .pipe(z.record(HubWidgetIdSchema, z.unknown()))
      .default({}),
  })
  .strict()
  .superRefine((prefs, ctx) => {
    checkConfig(prefs.config, ctx);
    if (JSON.stringify(prefs).length > HUB_WIDGET_PREFS_MAX_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `Layout is larger than ${HUB_WIDGET_PREFS_MAX_CHARS} characters`,
      });
    }
  });
/** Parsed (output) shape — `config` always present. */
export type HubWidgetPrefs = z.infer<typeof HubWidgetPrefsSchema>;
/** Wire (input) shape — `config` may be omitted. */
export type HubWidgetPrefsInput = z.input<typeof HubWidgetPrefsSchema>;

/** `PATCH /guilds/:id/widget-prefs` body: a full layout, or Reset (stores `null`). */
export const HubWidgetPrefsResetSchema = z
  .object({ reset: z.literal(true) })
  .strict();
export const UpdateHubWidgetPrefsSchema = z.union([
  HubWidgetPrefsSchema,
  HubWidgetPrefsResetSchema,
]);
export type UpdateHubWidgetPrefs = z.infer<typeof UpdateHubWidgetPrefsSchema>;
export type UpdateHubWidgetPrefsBody = z.input<
  typeof UpdateHubWidgetPrefsSchema
>;

/** `PATCH /guilds/:id/widget-prefs` response: what is now stored. */
export const HubWidgetPrefsResponseSchema = z
  .object({ widgetPrefs: HubWidgetPrefsSchema.nullable() })
  .strict();
export type HubWidgetPrefsResponse = z.infer<
  typeof HubWidgetPrefsResponseSchema
>;

/**
 * ROK-1969 D6 — renamed widget ids, old → new. The resolver ignores an id it
 * does not know, so a rename without an alias would drop that hub's saved
 * order/hidden/added state for the widget. A `Map` for the same reason as
 * `CONFIG_SCHEMAS`. **Never remove an entry:** a row not saved since the
 * rename still carries the old id.
 */
export const LEGACY_HUB_WIDGET_IDS: ReadonlyMap<string, string> = new Map([
  ["plugin:valheim:gallery", "plugin:core:gallery"],
]);

const currentId = (id: string): string => LEGACY_HUB_WIDGET_IDS.get(id) ?? id;

/** Maps every id through the alias and keeps the first of any duplicates. */
function normaliseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(currentId))];
}

/**
 * Rewrites legacy widget ids in a saved layout (`order`, `hidden`, `added`
 * and `config` keys) to their current ids, de-duplicating so the first
 * position wins. Pure — the input is not mutated. The web resolver applies
 * it on read and the api applies it before it stores a layout.
 */
export function normaliseHubWidgetPrefs(prefs: HubWidgetPrefs): HubWidgetPrefs {
  const config = new Map<string, unknown>();
  for (const [key, value] of Object.entries(prefs.config)) {
    const id = currentId(key);
    if (!config.has(id)) config.set(id, value);
  }
  return {
    order: normaliseIds(prefs.order),
    hidden: normaliseIds(prefs.hidden),
    added: normaliseIds(prefs.added),
    config: Object.fromEntries(config),
  };
}
