import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddonExportSection, AddonWho } from '@raid-ledger/contract';
import type { AddonBindingCharacter } from './addon-import.binding';
import {
  bindEverySection,
  type AddonBindingSection,
} from './addon-import.binding-paste';

/** ROK-1737 (Codex P2) — a mixed paste binds every section, all-or-nothing. */

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const base = (
  JSON.parse(readFileSync(join(FIXTURES, 'char-normal.json'), 'utf8')) as {
    payload: AddonBindingSection;
  }
).payload;

const GUID = 'Player-4395-0ABCDEF0';
const character: AddonBindingCharacter = {
  gameSlug: 'world-of-warcraft-forever',
  name: 'Ana Forever',
  region: 'us',
  ruleset: 'normal',
  class: 'Paladin',
  level: 60,
  addonGuid: GUID,
  race: 'Human',
};
const section = (
  who: Partial<AddonWho> = {},
  region = 1,
  kind: AddonExportSection = 'char',
  exportedAt = base.exportedAt,
): AddonBindingSection => ({
  section: kind,
  exportedAt,
  client: { region },
  who: { ...base.who, ...who },
});
const APPLY = { dryRun: false };

describe('bindEverySection', () => {
  it('a single clean section binds exactly as bindToCharacter does', () => {
    expect(bindEverySection([section()], character, APPLY)).toEqual({
      errors: [],
      warnings: [],
      diff: {},
      pinGuid: null,
    });
  });

  it('rejects when only a LATER section carries another region', () => {
    const r = bindEverySection([section(), section({}, 3)], character, APPLY);
    expect(r.errors.map((e) => e.code)).toEqual(['REGION_MISMATCH']);
  });

  it('rejects when only a LATER section carries another exporter name', () => {
    const later = section({
      fullName: 'Bea Forever',
      raw: { getUnitName: 'Bea Forever' },
    });
    const r = bindEverySection([section(), later], character, APPLY);
    expect(r.errors.map((e) => e.code)).toEqual(['NAME_MISMATCH']);
  });

  it('keeps errors in section order (the first section throws first)', () => {
    const r = bindEverySection(
      [section({}, 3), section({ fullName: 'Bea', raw: {} })],
      character,
      APPLY,
    );
    expect(r.errors.map((e) => e.code)).toEqual([
      'REGION_MISMATCH',
      'NAME_MISMATCH',
    ]);
  });

  it('de-duplicates identical warnings; GUID confirm semantics unchanged', () => {
    const repinned = { ...character, addonGuid: 'Player-4395-0FFFFFF0' };
    const preview = bindEverySection(
      [section({ level: 59 }), section({ level: 59 })],
      repinned,
      { dryRun: true },
    );
    expect(preview.warnings.map((w) => w.code)).toEqual([
      'GUID_CHANGED',
      'CLASS_LEVEL_UPDATED',
    ]);
    expect(preview.diff).toEqual({ level: { from: 60, to: 59 } });
    const apply = bindEverySection([section(), section()], repinned, APPLY);
    expect(apply.errors[0]?.code).toBe('GUID_CONFIRM_REQUIRED');
    const confirmed = bindEverySection([section(), section()], repinned, {
      dryRun: false,
      confirm: { repinGuid: true },
    });
    expect(confirmed.errors).toEqual([]);
    expect(confirmed.pinGuid).toBe(GUID);
  });

  // Codex P2 (3d9b6abcc): the row follows ONE authoritative section.
  it('a guild-first paste takes class/level from the char section, not the first or newest', () => {
    const at58 = { ...character, level: 58 };
    const guild = section({ level: 58 }, 1, 'guild', base.exportedAt + 60);
    const char = section({ level: 59 }, 1, 'char', base.exportedAt);
    const r = bindEverySection([guild, char], at58, APPLY);
    expect(r.errors).toEqual([]);
    expect(r.diff).toEqual({ level: { from: 58, to: 59 } });
    expect(r.warnings.map((w) => w.code)).toEqual(['CLASS_LEVEL_UPDATED']);
  });

  it('with no char section the newest exportedAt wins (level + ruleset)', () => {
    const at58 = { ...character, level: 58 };
    const guild = section({ level: 58 }, 1, 'guild', base.exportedAt);
    const raid = section(
      { level: 59, ruleset: 'hardcore' },
      1,
      'raid',
      base.exportedAt + 60,
    );
    const r = bindEverySection([guild, raid], at58, {
      dryRun: false,
      confirm: { updateRuleset: true },
    });
    expect(r.errors).toEqual([]);
    expect(r.diff).toEqual({ level: { from: 58, to: 59 } });
    expect(r.setRuleset).toBe('hardcore');
  });
});
