import { z } from 'zod';
import { GuildKindSchema } from './guilds.schema.js';

/**
 * ROK-1969 §3.5 (operator ruling 2026-10-25) — what an admin must do before a
 * plugin works: a companion mod on the game server, a secret in its config, a
 * Pelican egg or startup variable, an admin setting… Every plugin hub
 * manifest carries one `setup` section (Core's is an explicit empty list).
 * The install sheet renders it as a checklist and the api reports each
 * requirement's met/unmet state through its `check` id (`PluginInfo.setupStatus`).
 * The `pelican` hints are shaped so a later story can apply them through the
 * Pelican API. A manifest names what is needed and where it goes — NEVER a
 * secret value.
 */

/** What kind of step a setup requirement is. */
export const PLUGIN_SETUP_KINDS = [
  'server_mod',
  'server_secret',
  'pelican_egg',
  'pelican_variable',
  'companion_app',
  'steam_link',
  'discord_channel',
  'admin_setting',
  'other',
] as const;
export const PluginSetupKindSchema = z.enum(PLUGIN_SETUP_KINDS);
export type PluginSetupKind = z.infer<typeof PluginSetupKindSchema>;

const REQUIRED_INSTRUCTIONS = 'Setup instructions are required';

export const PluginSetupLinkSchema = z
  .object({
    label: z.string().min(1).max(60),
    url: z.string().max(300).regex(/^https:\/\/\S+$/, 'Links must be https'),
  })
  .strict();
export type PluginSetupLink = z.infer<typeof PluginSetupLinkSchema>;

/** Where a requirement lands on a Pelican server — what a Pelican-applied setup would write. */
export const PluginSetupPelicanSchema = z
  .object({
    /** A startup variable env name (`RL_LINK_TOKEN`). */
    variable: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Invalid variable').optional(),
    /** Which egg (or egg feature) the server needs, in words. */
    eggHint: z.string().min(1).max(120).optional(),
    /** Paths relative to the server root the requirement installs or edits. */
    files: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  })
  .strict();
export type PluginSetupPelican = z.infer<typeof PluginSetupPelicanSchema>;

/** `<plugin>.<name>` — how the api names the check it runs for met/unmet. */
const CHECK_ID = /^[a-z0-9-]+\.[a-z0-9_]+$/;

export const PluginSetupRequirementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, 'Invalid id'),
    kind: PluginSetupKindSchema,
    title: z.string().min(1).max(80),
    /** Markdown, plain numbered steps. Where to click, what to paste, where it goes. */
    instructions: z
      .string({ error: REQUIRED_INSTRUCTIONS })
      .trim()
      .min(1, REQUIRED_INSTRUCTIONS)
      .max(2000),
    /** `false` = the plugin works without it, with less (shown as optional). */
    required: z.boolean(),
    /** Hub kinds this applies to; omitted = every hub (or none — app-wide). */
    appliesTo: z.array(GuildKindSchema).min(1).optional(),
    links: z.array(PluginSetupLinkSchema).max(5).optional(),
    check: z.string().regex(CHECK_ID, 'A check id is <plugin>.<name>').optional(),
    pelican: PluginSetupPelicanSchema.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const placed = r.pelican?.variable !== undefined || r.pelican?.files !== undefined;
    if (r.kind === 'server_secret' && !placed) {
      ctx.addIssue({
        code: 'custom',
        path: ['pelican'],
        message: 'A server_secret must name where it goes (pelican.variable or pelican.files)',
      });
    }
  });
export type PluginSetupRequirement = z.infer<typeof PluginSetupRequirementSchema>;

export const PluginSetupSchema = z
  .object({ requirements: z.array(PluginSetupRequirementSchema).max(20) })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.requirements.forEach((r, index) => {
      if (seen.has(r.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['requirements', index, 'id'],
          message: `Duplicate setup requirement id "${r.id}"`,
        });
      }
      seen.add(r.id);
    });
  });
export type PluginSetup = z.infer<typeof PluginSetupSchema>;

/**
 * One requirement's live state on `PluginInfo.setupStatus` (L2). `unknown` =
 * no `check`, or the api has no check for it yet. `detail` is plain copy
 * (`Last upload 3 min ago`) — never a secret.
 */
export const PluginSetupStateSchema = z.enum(['met', 'unmet', 'unknown']);
export type PluginSetupState = z.infer<typeof PluginSetupStateSchema>;

export const PluginSetupStatusSchema = z
  .object({
    id: z.string().min(1).max(60),
    state: PluginSetupStateSchema,
    detail: z.string().max(200).optional(),
  })
  .strict();
export type PluginSetupStatus = z.infer<typeof PluginSetupStatusSchema>;
