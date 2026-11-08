/**
 * ROK-2136 — pure helpers for the guild's in-game MOTD / Guild Information:
 * row → DTO, the per-field diff + conflict decision (D6), the column patch.
 */
import {
  PutGuildIngameTextSchema,
  normaliseIngameText,
  type GuildIngameText,
  type GuildIngameTextField,
  type IngameTextFieldKey,
  type PutGuildIngameText,
} from '@raid-ledger/contract';
import { parseOrThrow } from '../../../guilds/posts/hub-posts.service.helpers';

export const INGAME_TEXT_FIELDS: readonly IngameTextFieldKey[] = [
  'motd',
  'info',
];

/** `findIngameText`'s row: text, token and editor name per field. */
export interface IngameTextRow {
  motd: string | null;
  motdUpdatedAt: string | null;
  motdEditor: string | null;
  info: string | null;
  infoUpdatedAt: string | null;
  infoEditor: string | null;
}

/** One locked field: its text and its concurrency token. */
export interface StoredField {
  text: string | null;
  updatedAt: string | null;
}
export type StoredIngameTexts = Record<IngameTextFieldKey, StoredField>;

/** The planned write: each changed field's new text (null = cleared). */
export type IngameTextPlan =
  | { outcome: 'conflict' }
  | {
      outcome: 'ok';
      changes: Partial<Record<IngameTextFieldKey, string | null>>;
    };

/** The `guild_profiles` columns a save sets (only the changed fields'). */
export interface IngameTextPatch {
  ingameMotd?: string | null;
  ingameMotdUpdatedAt?: Date;
  ingameMotdUpdatedBy?: number;
  ingameInfo?: string | null;
  ingameInfoUpdatedAt?: Date;
  ingameInfoUpdatedBy?: number;
}

/** 400 (field-keyed) on a bad body — caps and control characters (D5). */
export function parseIngameTextPut(input: unknown): PutGuildIngameText {
  return parseOrThrow(PutGuildIngameTextSchema, input);
}

/** D4: what is stored is what is copied; `''` after normalising = cleared. */
export function normaliseForStorage(text: string): string | null {
  const normalised = normaliseIngameText(text);
  return normalised === '' ? null : normalised;
}

function toField(
  text: string | null,
  updatedAt: string | null,
  editor: string | null,
): GuildIngameTextField | null {
  if (text === null || updatedAt === null) return null;
  return { text, updatedAt, updatedBy: editor };
}

/** Row → `GuildIngameText`; a field never set (or cleared) is null. */
export function toIngameTextDto(
  guildId: number,
  row: IngameTextRow | null,
  canEdit: boolean,
): GuildIngameText {
  return {
    guildId,
    motd: row ? toField(row.motd, row.motdUpdatedAt, row.motdEditor) : null,
    info: row ? toField(row.info, row.infoUpdatedAt, row.infoEditor) : null,
    viewer: { canEdit },
  };
}

/**
 * The token the client saw: a cleared field reads as null (the DTO hides its
 * stamp), so its token is null too — else a reload could never save it.
 */
export function visibleToken(field: StoredField): string | null {
  return field.text === null ? null : field.updatedAt;
}

function baseFor(input: PutGuildIngameText, key: IngameTextFieldKey) {
  return key === 'motd' ? input.baseMotdUpdatedAt : input.baseInfoUpdatedAt;
}

/**
 * D6: only fields whose normalised text differs are written; a changed field
 * whose stored token ≠ its `base*UpdatedAt` makes the whole save a 409.
 */
export function planIngameTextWrite(
  stored: StoredIngameTexts,
  input: PutGuildIngameText,
): IngameTextPlan {
  const changes: Partial<Record<IngameTextFieldKey, string | null>> = {};
  for (const key of INGAME_TEXT_FIELDS) {
    const next = normaliseForStorage(input[key]);
    if (next === stored[key].text) continue;
    if (visibleToken(stored[key]) !== baseFor(input, key)) {
      return { outcome: 'conflict' };
    }
    changes[key] = next;
  }
  return { outcome: 'ok', changes };
}

/** The column patch for the planned changes; null when nothing changed. */
export function buildIngameTextPatch(
  changes: Partial<Record<IngameTextFieldKey, string | null>>,
  actorId: number,
  now: Date,
): IngameTextPatch | null {
  const patch: IngameTextPatch = {};
  if (changes.motd !== undefined) {
    patch.ingameMotd = changes.motd;
    patch.ingameMotdUpdatedAt = now;
    patch.ingameMotdUpdatedBy = actorId;
  }
  if (changes.info !== undefined) {
    patch.ingameInfo = changes.info;
    patch.ingameInfoUpdatedAt = now;
    patch.ingameInfoUpdatedBy = actorId;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
