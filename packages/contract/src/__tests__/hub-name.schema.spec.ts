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
  ['U+200C ZWNJ', '‌'],
  ['U+200D ZWJ', '‍'],
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
