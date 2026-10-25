import { z } from 'zod';
import { PluginSetupSchema } from './plugin-setup.schema.js';

/**
 * ROK-1969 — what a plugin adds to hubs. Every hub widget, tab and hub
 * behaviour belongs to exactly one plugin; the built-in `core` plugin owns
 * the shared ones. The api serves it on `PluginInfoDto.hub` (install sheet)
 * and both api and web guard tests check live registrations against the
 * declarations in `plugin-hub-manifests.ts`, in both directions.
 * Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

/** The built-in plugin that owns every shared hub widget/tab/behaviour. Always on. */
export const CORE_PLUGIN_ID = 'core' as const;

/** The kinds of non-visual hub behaviour a plugin can declare. */
export const HUB_BEHAVIOUR_KINDS = [
  'hub-kind',
  'event-tagger',
  'log-parser',
  'scheduled-job',
  'ingest-source',
  'media-classifier',
  'media-decorator',
] as const;
export const HubBehaviourKindSchema = z.enum(HUB_BEHAVIOUR_KINDS);
export type HubBehaviourKind = z.infer<typeof HubBehaviourKindSchema>;

const declId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, 'Invalid id');

/**
 * How a widget's saved-layout key (`Cell.key`) is formed: `bare` = the id
 * itself (core band only — `gm-post`…), `plugin` = `plugin:<slug>:<id>`,
 * `module` = `module:<id>` (a hub-kind module's Overview widget).
 */
export const HubWidgetLayoutKeySchema = z.enum(['bare', 'plugin', 'module']);
export type HubWidgetLayoutKey = z.infer<typeof HubWidgetLayoutKeySchema>;

export const PluginHubWidgetDeclSchema = z
  .object({
    /** The registration id, not the `Cell.key`. */
    id: declId,
    title: z.string().min(1).max(60),
    description: z.string().max(140).optional(),
    layoutKey: HubWidgetLayoutKeySchema.default('plugin'),
  })
  .strict();
export type PluginHubWidgetDecl = z.infer<typeof PluginHubWidgetDeclSchema>;

export const PluginHubTabDeclSchema = z
  .object({
    id: declId,
    label: z.string().min(1).max(40),
    /** Registered but hidden until its story ships; the install sheet omits it. */
    planned: z.boolean().optional(),
  })
  .strict();
export type PluginHubTabDecl = z.infer<typeof PluginHubTabDeclSchema>;

export const PluginHubBehaviourDeclSchema = z
  .object({
    /** Stable id within its kind; a scheduled job may keep its real job name. */
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, 'Invalid id'),
    kind: HubBehaviourKindSchema,
    label: z.string().min(1).max(80),
  })
  .strict();
export type PluginHubBehaviourDecl = z.infer<
  typeof PluginHubBehaviourDeclSchema
>;

/** Adds an issue at `[list, index, 'id']` for every repeated key. */
function flagDuplicates(
  keys: readonly string[],
  list: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  keys.forEach((key, index) => {
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [list, index, 'id'],
        message: `Duplicate ${list} id "${key}"`,
      });
    }
    seen.add(key);
  });
}

export const PluginHubManifestSchema = z
  .object({
    widgets: z.array(PluginHubWidgetDeclSchema).default([]),
    tabs: z.array(PluginHubTabDeclSchema).default([]),
    behaviours: z.array(PluginHubBehaviourDeclSchema).default([]),
    /** Games a game plugin's widgets may target (web guard: `games` ⊆ this). */
    gameSlugs: z.array(z.string().min(1)).optional(),
    /** REQUIRED (§3.5): what an admin must set up; `{ requirements: [] }` = nothing. */
    setup: PluginSetupSchema,
  })
  .strict()
  .superRefine((m, ctx) => {
    flagDuplicates(m.widgets.map((w) => w.id), 'widgets', ctx);
    flagDuplicates(m.tabs.map((t) => t.id), 'tabs', ctx);
    flagDuplicates(m.behaviours.map((b) => `${b.kind}:${b.id}`), 'behaviours', ctx);
  });
/** Parsed (output) shape — every list present, `layoutKey` filled. */
export type PluginHubManifest = z.infer<typeof PluginHubManifestSchema>;
/** Wire (input) shape — lists and `layoutKey` may be omitted. */
export type PluginHubManifestInput = z.input<typeof PluginHubManifestSchema>;

/** A fresh declaration for a plugin that adds nothing to hubs and needs no setup. */
export function emptyPluginHubManifest(): PluginHubManifest {
  return { widgets: [], tabs: [], behaviours: [], setup: { requirements: [] } };
}
