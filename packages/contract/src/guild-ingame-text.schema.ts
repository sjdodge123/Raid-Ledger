import { z } from 'zod';

/**
 * ROK-2136 — guild text sync P0: the WoW: Forever guild Message of the Day and
 * Guild Information, edited on the hub (the source of truth) and copied into
 * the in-game boxes. Plugin-owned (`blizzard`). Not part of the LedgerLink
 * wire format — ROK-2137 (P1) adds an optional `reported` key additively.
 *
 * Lengths are UTF-16 code units (`string.length`, D3): conservative against
 * the in-game `SetMaxLetters`, and never above the DB `char_length` CHECK.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

/** In-game edit-box caps (forever-branch GuildInfo.lua SetMaxLetters, spike §2). */
export const WOW_GUILD_MOTD_MAX = 255;
export const WOW_GUILD_INFO_MAX = 499;

/** The two in-game text fields. */
export type IngameTextFieldKey = 'motd' | 'info';

/**
 * C0/C1 control characters and DEL, except `\n` and `\r` (CR/CRLF is
 * normalised to LF on write). Never intended text; rejected with a 400 (D5).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** True when `text` carries a control character the server rejects (D5). */
export function hasIngameControlChars(text: string): boolean {
  return CONTROL_CHAR_RE.test(text);
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_GLOBAL_RE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * ROK-2137 — drop every character `hasIngameControlChars` rejects (same
 * rule), so text the game reported can always be adopted through the save.
 */
export function stripIngameControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_GLOBAL_RE, '');
}

const putText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((text) => !hasIngameControlChars(text), {
      message: 'Remove control characters (tabs and other invisible characters)',
    });

/** One stored field. `updatedBy` = display name, null once the user is wiped. */
export const GuildIngameTextFieldSchema = z
  .object({
    /** Stored text is never empty — a cleared field is null. */
    text: z.string().min(1),
    updatedAt: isoDate,
    updatedBy: z.string().nullable(),
  })
  .strict();
export type GuildIngameTextField = z.infer<typeof GuildIngameTextFieldSchema>;

const storedField = (max: number) =>
  GuildIngameTextFieldSchema.extend({ text: z.string().min(1).max(max) })
    .strict()
    .nullable();

/** The field keys in route order — `POST …/ingame-text/:field/adopt|push`. */
export const INGAME_TEXT_FIELD_KEYS = ['motd', 'info'] as const;

/**
 * ROK-2137 — what the game last reported for one field (LedgerLink export).
 * `gameText` `''` = the in-game box was reported empty. `changedInGame` = the
 * report differs from the hub text and was not pushed over (acknowledged)
 * since it arrived.
 */
export const GuildIngameGameReportSchema = z
  .object({
    gameText: z.string(),
    gameReportedAt: isoDate,
    /** The exporting character's name; omitted when the report carried none. */
    gameReportedBy: z.string().min(1).max(100).optional(),
    changedInGame: z.boolean(),
  })
  .strict();
export type GuildIngameGameReport = z.infer<typeof GuildIngameGameReportSchema>;

const gameReport = (max: number) =>
  GuildIngameGameReportSchema.extend({ gameText: z.string().max(max) })
    .strict()
    .nullable();

/** Per field: the last in-game report, null when never reported. */
export const GuildIngameGameTextSchema = z
  .object({
    motd: gameReport(WOW_GUILD_MOTD_MAX),
    info: gameReport(WOW_GUILD_INFO_MAX),
  })
  .strict();
export type GuildIngameGameText = z.infer<typeof GuildIngameGameTextSchema>;

/**
 * ROK-2137 — `POST …/ingame-text/:field/adopt|push` body: what the editor saw.
 * `gameReportedAt` must still be the stored report (else 409 with the fresh
 * `ingameText`); Adopt also sends the field's hub `updatedAt` (null = unset)
 * as the ROK-2136 save's per-field conflict token. Push ignores it.
 */
export const GuildIngameGameActionSchema = z
  .object({
    baseUpdatedAt: isoDate.nullable(),
    gameReportedAt: isoDate,
  })
  .strict();
export type GuildIngameGameAction = z.infer<typeof GuildIngameGameActionSchema>;

/** `GET /plugins/wow/guilds/:id/ingame-text` (and the PUT/409 response body). */
export const GuildIngameTextSchema = z
  .object({
    guildId: id,
    motd: storedField(WOW_GUILD_MOTD_MAX),
    info: storedField(WOW_GUILD_INFO_MAX),
    /** Same idiom as `HubSessionNoteResponse.viewer`, minus `canTick`. */
    viewer: z.object({ canEdit: z.boolean() }).strict(),
    /** ROK-2137 — editors only (`viewer.canEdit`); omitted for everyone else. */
    game: GuildIngameGameTextSchema.optional(),
  })
  .strict();
export type GuildIngameText = z.infer<typeof GuildIngameTextSchema>;

/**
 * `PUT /plugins/wow/guilds/:id/ingame-text`. Send only the fields the editor
 * changed, each with its `base*UpdatedAt` — the `updatedAt` the editor loaded
 * (null when unset). An omitted field is untouched and never conflict-checked,
 * so editing only Info never 409s on a concurrent MOTD change; a sent field
 * whose base mismatches is a 409 (D6). `''` (after `normaliseIngameText`)
 * clears the field. A body carrying only base tokens (no `motd`/`info`) is a
 * 200 no-op: nothing is checked, stamped or written.
 */
export const PutGuildIngameTextSchema = z
  .object({
    motd: putText(WOW_GUILD_MOTD_MAX).optional(),
    info: putText(WOW_GUILD_INFO_MAX).optional(),
    baseMotdUpdatedAt: isoDate.nullable().optional(),
    baseInfoUpdatedAt: isoDate.nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.motd !== undefined && body.baseMotdUpdatedAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseMotdUpdatedAt'],
        message: 'Required when motd is sent',
      });
    }
    if (body.info !== undefined && body.baseInfoUpdatedAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseInfoUpdatedAt'],
        message: 'Required when info is sent',
      });
    }
  });
export type PutGuildIngameText = z.infer<typeof PutGuildIngameTextSchema>;

/**
 * Write normalisation (D4): CRLF/CR → LF, strip trailing whitespace on each
 * line and at the end; leading whitespace is kept. What is stored is what is
 * copied, byte for byte.
 */
export function normaliseIngameText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\s+$/, '');
}

/** Characters the in-game box may not show as typed — warned, never blocked. */
export type IngameTextWarning = 'pipe' | 'astral' | 'newline-in-motd';

/** Client-side warnings for one field (OQ-4/OQ-5/OQ-11, ruled 2026-11-08). */
export function findIngameTextWarnings(
  text: string,
  field: IngameTextFieldKey,
): IngameTextWarning[] {
  const warnings: IngameTextWarning[] = [];
  if (text.includes('|')) warnings.push('pipe');
  if (/[\u{10000}-\u{10FFFF}]/u.test(text)) warnings.push('astral');
  if (field === 'motd' && /[\r\n]/.test(text)) warnings.push('newline-in-motd');
  return warnings;
}
