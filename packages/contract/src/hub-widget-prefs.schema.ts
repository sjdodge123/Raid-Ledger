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
const CONFIG_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "generic:text": HubTextWidgetConfigSchema,
};
export const HUB_CONFIGURABLE_WIDGET_IDS = Object.keys(CONFIG_SCHEMAS);

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
    const schema = CONFIG_SCHEMAS[key];
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
    config: z.record(HubWidgetIdSchema, z.unknown()).default({}),
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
