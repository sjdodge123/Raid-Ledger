/**
 * ROK-1950 Codex P2 — hub-name spoofing. `HubNameSchema` (the INPUT rule for
 * create/approve/admin-create/rename) rejects blank fillers, zero-width and
 * bidi/format characters and NFC-normalises; READ schemas keep `z.string()`
 * so a legacy stored name still parses on the web.
 */
import { describe, expect, it } from 'vitest';
import { HubNameSchema } from '../community-hubs.schema.js';
import { HubRenameSchema } from '../hub-rename.schema.js';
import { GuildSummarySchema } from '../guilds.schema.js';

const INVISIBLES: [string, string][] = [
  ['U+3164 HANGUL FILLER', 'ㅤ'],
  ['U+115F HANGUL CHOSEONG FILLER', 'ᅟ'],
  ['U+1160 HANGUL JUNGSEONG FILLER', 'ᅠ'],
  ['U+FFA0 HALFWIDTH HANGUL FILLER', 'ﾠ'],
  ['U+2800 BRAILLE BLANK', '⠀'],
  ['U+200B ZERO WIDTH SPACE', '​'],
  ['U+2060 WORD JOINER', '⁠'],
  ['U+FEFF BOM', '﻿'],
  ['U+202E RLO', '‮'],
  ['U+202A LRE', '‪'],
  ['U+2066 LRI', '⁦'],
  ['U+2069 PDI', '⁩'],
  ['U+00AD SOFT HYPHEN (Cf)', '­'],
];

describe('HubNameSchema — invisible characters', () => {
  it.each(INVISIBLES)('rejects an embedded %s', (_label, ch) => {
    expect(HubNameSchema.safeParse(`Iron${ch}Wolves`).success).toBe(false);
  });

  it('rejects a name made only of Hangul fillers', () => {
    expect(HubNameSchema.safeParse('ㅤㅤㅤㅤ').success).toBe(false);
  });

  it('rejects a filler-padded copy of a real name via the rename body', () => {
    expect(HubRenameSchema.safeParse({ name: 'Iron Wolvesㅤ' }).success).toBe(false);
  });

  it('still accepts ordinary names, accents and emoji', () => {
    for (const n of ['Iron Wolves', 'Les Écorchés', '火狐 Guild', 'Wolves 🐺']) {
      expect(HubNameSchema.safeParse(n).success).toBe(true);
    }
  });
});

/**
 * ROK-2016 (operator ruling 2026-10-26): U+200D ZWJ and U+200C ZWNJ are
 * allowed only BETWEEN two letters/marks/emoji (emoji sequences, Persian and
 * Indic script). Any other placement, and every other `\p{Cf}`, is refused.
 */
describe('HubNameSchema — joiners between letters or emoji (ROK-2016)', () => {
  const ACCEPTED: [string, string][] = [
    ['family emoji (ZWJ sequence)', 'Fam \u{1F468}\u200D\u{1F469}\u200D\u{1F467}'],
    ['skin-tone emoji joined by ZWJ', 'Devs \u{1F469}\u{1F3FD}\u200D\u{1F4BB}'],
    ['VS16 emoji joined by ZWJ', 'Pride \u{1F3F3}\uFE0F\u200D\u{1F308}'],
    ['Persian name with ZWNJ', '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645'],
    ['ZWJ between two Latin letters', 'Iron\u200DWolves'],
  ];
  it.each(ACCEPTED)('accepts %s', (_label, name) => {
    expect(HubNameSchema.safeParse(name).success).toBe(true);
  });

  it('keeps the joiner in the parsed name', () => {
    expect(HubNameSchema.parse('Iron\u200CWolves')).toBe('Iron\u200CWolves');
  });

  const REFUSED: [string, string][] = [
    ['a leading ZWJ', '\u200DIron Wolves'],
    ['a trailing ZWJ', 'Iron Wolves\u200D'],
    ['a doubled ZWJ', 'Iron\u200D\u200DWolves'],
    ['a ZWJ before a space', 'Iron\u200D Wolves'],
    ['a ZWJ after a space', 'Iron \u200DWolves'],
    ['a ZWNJ between digits', 'Clan 12\u200C34'],
    ['a ZWJ after an emoji but before a digit', 'Wolves \u{1F43A}\u200D1'],
    ['U+200B between letters', 'Iron\u200BWolves'],
    ['U+2060 between letters', 'Iron\u2060Wolves'],
    ['a lone ZWNJ in the middle of a run of spaces', 'Iron \u200C Wolves'],
  ];
  it.each(REFUSED)('refuses %s with the invisible-character message', (_label, name) => {
    const r = HubNameSchema.safeParse(name);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(
      'Hub name cannot contain invisible characters',
    );
  });
});

describe('HubNameSchema — NFC normalisation', () => {
  it('returns the NFC form of a decomposed name', () => {
    const decomposed = 'Café Club';
    const out = HubNameSchema.parse(decomposed);
    expect(out).toBe('Café Club');
    expect(out).not.toBe(decomposed);
  });

  it('measures the max length on the normalised form', () => {
    // 65 code units raw (63 a + e + U+0301), 64 after NFC: fits the 64 max.
    const name = `${'a'.repeat(63)}é`;
    expect(name.length).toBe(65);
    expect(HubNameSchema.safeParse(name).success).toBe(true);
  });
});

describe('read schemas stay permissive for stored names', () => {
  it('GuildSummarySchema parses a legacy name with a zero-width char', () => {
    const legacy = {
      id: 1,
      gameId: 2,
      kind: 'game_community',
      name: 'Old​Hub',
      region: '',
      realmSlug: null,
      realmName: null,
      faction: null,
      memberCount: 0,
      lastSnapshotAt: null,
    };
    const parsed = GuildSummarySchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe('Old​Hub');
  });
});
