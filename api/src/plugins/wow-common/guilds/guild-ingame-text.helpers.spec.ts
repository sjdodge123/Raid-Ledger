/**
 * ROK-2136 — pure helpers: row → DTO, normalisation for storage (D4), the
 * per-field diff + conflict decision table (D6, AC8/AC9), the column patch,
 * and the 400 on control characters / caps (D5, AC5/AC7).
 */
import { BadRequestException } from '@nestjs/common';
import type { PutGuildIngameText } from '@raid-ledger/contract';
import {
  buildIngameTextPatch,
  normaliseForStorage,
  parseIngameTextPut,
  planIngameTextWrite,
  toIngameTextDto,
  type IngameTextRow,
  type StoredIngameTexts,
} from './guild-ingame-text.helpers';

const T1 = '2026-11-08T10:00:00.123456Z';
const T2 = '2026-11-08T11:00:00.654321Z';

const row = (over: Partial<IngameTextRow> = {}): IngameTextRow => ({
  motd: null,
  motdUpdatedAt: null,
  motdEditor: null,
  info: null,
  infoUpdatedAt: null,
  infoEditor: null,
  ...over,
});

const stored = (
  motd: [string | null, string | null],
  info: [string | null, string | null],
): StoredIngameTexts => ({
  motd: { text: motd[0], updatedAt: motd[1] },
  info: { text: info[0], updatedAt: info[1] },
});

const put = (over: Partial<PutGuildIngameText> = {}): PutGuildIngameText => ({
  motd: '',
  info: '',
  baseMotdUpdatedAt: null,
  baseInfoUpdatedAt: null,
  ...over,
});

/** The 400's body for a bad PUT, or a loud failure when it parsed. */
function badRequestBody(input: unknown): unknown {
  try {
    parseIngameTextPut(input);
  } catch (err) {
    if (err instanceof BadRequestException) return err.getResponse();
    throw err;
  }
  throw new Error('expected a BadRequestException, but the body parsed');
}

describe('toIngameTextDto', () => {
  it('returns both fields null when the guild has no profile row', () => {
    expect(toIngameTextDto(7, null, false)).toEqual({
      guildId: 7,
      motd: null,
      info: null,
      viewer: { canEdit: false },
    });
  });

  it('maps a set field and keeps a wiped editor as null', () => {
    const dto = toIngameTextDto(
      7,
      row({ motd: 'Raid tonight', motdUpdatedAt: T1, motdEditor: null }),
      true,
    );
    expect(dto.motd).toEqual({
      text: 'Raid tonight',
      updatedAt: T1,
      updatedBy: null,
    });
    expect(dto.info).toBeNull();
    expect(dto.viewer).toEqual({ canEdit: true });
  });

  it('hides a cleared field (text null) even though it carries a stamp', () => {
    const dto = toIngameTextDto(
      7,
      row({ info: null, infoUpdatedAt: T1, infoEditor: 'Thrall' }),
      false,
    );
    expect(dto.info).toBeNull();
  });
});

describe('normaliseForStorage', () => {
  it('normalises CRLF and strips trailing whitespace per line (AC6)', () => {
    expect(normaliseForStorage('Raid tonight  \r\nBring flasks  ')).toBe(
      'Raid tonight\nBring flasks',
    );
  });

  it('keeps a leading space', () => {
    expect(normaliseForStorage('  indented')).toBe('  indented');
  });

  it('stores whitespace-only text as null (cleared)', () => {
    expect(normaliseForStorage('  \r\n  ')).toBeNull();
    expect(normaliseForStorage('')).toBeNull();
  });
});

describe('planIngameTextWrite (D6)', () => {
  it('is a no-op when neither normalised text changed (AC8)', () => {
    const plan = planIngameTextWrite(
      stored(['Raid tonight', T1], [null, null]),
      put({ motd: 'Raid tonight  ', baseMotdUpdatedAt: 'stale-ignored' }),
    );
    expect(plan).toEqual({ outcome: 'ok', changes: {} });
  });

  it('writes a changed field whose base matches the stored token', () => {
    const plan = planIngameTextWrite(
      stored(['Old', T1], [null, null]),
      put({ motd: 'New', baseMotdUpdatedAt: T1 }),
    );
    expect(plan).toEqual({ outcome: 'ok', changes: { motd: 'New' } });
  });

  it('is a conflict when a changed field moved since the editor loaded (AC9)', () => {
    const plan = planIngameTextWrite(
      stored(['Theirs', T2], [null, null]),
      put({ motd: 'Mine', baseMotdUpdatedAt: T1 }),
    );
    expect(plan).toEqual({ outcome: 'conflict' });
  });

  it('is per field: a stale MOTD base does not block an info-only change (AC9)', () => {
    const plan = planIngameTextWrite(
      stored(['Theirs', T2], ['Info', T1]),
      put({
        motd: 'Theirs',
        baseMotdUpdatedAt: T1,
        info: 'New info',
        baseInfoUpdatedAt: T1,
      }),
    );
    expect(plan).toEqual({ outcome: 'ok', changes: { info: 'New info' } });
  });

  it('treats a cleared field token as null, so a reload can set it again', () => {
    const plan = planIngameTextWrite(
      stored([null, T2], [null, null]),
      put({ motd: 'Back again', baseMotdUpdatedAt: null }),
    );
    expect(plan).toEqual({ outcome: 'ok', changes: { motd: 'Back again' } });
  });

  it('plans a clear (null) when the text normalises to empty (AC6)', () => {
    const plan = planIngameTextWrite(
      stored(['Old', T1], [null, null]),
      put({ motd: '   ', baseMotdUpdatedAt: T1 }),
    );
    expect(plan).toEqual({ outcome: 'ok', changes: { motd: null } });
  });
});

describe('buildIngameTextPatch', () => {
  const now = new Date('2026-11-08T12:00:00.000Z');

  it('returns null when nothing changed', () => {
    expect(buildIngameTextPatch({}, 3, now)).toBeNull();
  });

  it('stamps only the changed field', () => {
    expect(buildIngameTextPatch({ info: null }, 3, now)).toEqual({
      ingameInfo: null,
      ingameInfoUpdatedAt: now,
      ingameInfoUpdatedBy: 3,
    });
  });
});

describe('parseIngameTextPut (D5, AC5/AC7)', () => {
  it('rejects a control character and names the field', () => {
    expect(badRequestBody(put({ info: 'bell\u0007' }))).toHaveProperty('info');
  });

  it('rejects a tab in the MOTD', () => {
    expect(badRequestBody(put({ motd: 'a\tb' }))).toHaveProperty('motd');
  });

  it('rejects 256 MOTD / 500 info characters and accepts 255 / 499', () => {
    expect(badRequestBody(put({ motd: 'm'.repeat(256) }))).toHaveProperty(
      'motd',
    );
    expect(badRequestBody(put({ info: 'i'.repeat(500) }))).toHaveProperty(
      'info',
    );
    const ok = put({ motd: 'm'.repeat(255), info: 'i'.repeat(499) });
    expect(parseIngameTextPut(ok)).toEqual(ok);
  });

  it('accepts CRLF (normalised later) and rejects unknown keys', () => {
    expect(parseIngameTextPut(put({ motd: 'a\r\nb' })).motd).toBe('a\r\nb');
    expect(() => parseIngameTextPut({ ...put(), extra: 1 })).toThrow(
      BadRequestException,
    );
  });
});
