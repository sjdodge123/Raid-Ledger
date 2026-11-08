/**
 * ROK-2137 — pure helpers for the in-game reported MOTD / Guild Information
 * (LedgerLink exports, stored by `applyGuildGameText`): the "Changed in game"
 * rule, the editor-only `game` DTO block, the route field and the Adopt body.
 */
import { BadRequestException } from '@nestjs/common';
import {
  INGAME_TEXT_FIELD_KEYS,
  type GuildIngameGameReport,
  type GuildIngameGameText,
  type IngameTextFieldKey,
  type PutGuildIngameText,
} from '@raid-ledger/contract';

/** `findGameText`'s row: reported text, its stamp, and "pushed over". */
export interface GameTextRow {
  motd: string | null;
  motdReportedAt: string | null;
  /** `acknowledged_at IS NOT NULL AND reported_at <= acknowledged_at`. */
  motdAcked: boolean;
  info: string | null;
  infoReportedAt: string | null;
  infoAcked: boolean;
}

/** One field's last report (`reportedAt` null = never reported). */
export interface GameFieldState {
  text: string | null;
  reportedAt: string | null;
  acked: boolean;
}

/** The hub's own stored text per field (null = unset/cleared). */
export type HubTexts = Record<IngameTextFieldKey, string | null>;

/** One field of the row; a missing row reads as never reported. */
export function gameFieldOf(
  row: GameTextRow | null,
  field: IngameTextFieldKey,
): GameFieldState {
  if (row === null) return { text: null, reportedAt: null, acked: false };
  return field === 'motd'
    ? { text: row.motd, reportedAt: row.motdReportedAt, acked: row.motdAcked }
    : { text: row.info, reportedAt: row.infoReportedAt, acked: row.infoAcked };
}

/**
 * Changed in game = a report exists AND it differs from the hub text (missing
 * = '') AND it was not pushed over (acknowledged) since it arrived. A hub edit
 * clears it only by making the hub text equal the report (ruling 2026-11-08).
 */
export function isChangedInGame(
  report: GameFieldState,
  hubText: string | null,
): boolean {
  if (report.reportedAt === null || report.acked) return false;
  return (report.text ?? '') !== (hubText ?? '');
}

function toReport(
  report: GameFieldState,
  hubText: string | null,
): GuildIngameGameReport | null {
  if (report.reportedAt === null) return null;
  return {
    gameText: report.text ?? '',
    gameReportedAt: report.reportedAt,
    changedInGame: isChangedInGame(report, hubText),
  };
}

/** Row → the editor-only `game` block of `GuildIngameText`. */
export function toGameTextDto(
  row: GameTextRow | null,
  hub: HubTexts,
): GuildIngameGameText {
  return {
    motd: toReport(gameFieldOf(row, 'motd'), hub.motd),
    info: toReport(gameFieldOf(row, 'info'), hub.info),
  };
}

/** `:field` of `…/ingame-text/:field/adopt|push`; 400 otherwise. */
export function parseIngameFieldKey(raw: string): IngameTextFieldKey {
  const key = INGAME_TEXT_FIELD_KEYS.find((k) => k === raw);
  if (key === undefined) {
    throw new BadRequestException(`Unknown field "${raw}" (motd or info)`);
  }
  return key;
}

/**
 * Adopt = a ROK-2136 save of the reported text for that one field, based on
 * the hub token the server just read (reported empty → '' clears the field).
 */
export function adoptPutBody(
  field: IngameTextFieldKey,
  gameText: string | null,
  baseUpdatedAt: string | null,
): PutGuildIngameText {
  return field === 'motd'
    ? { motd: gameText ?? '', baseMotdUpdatedAt: baseUpdatedAt }
    : { info: gameText ?? '', baseInfoUpdatedAt: baseUpdatedAt };
}
