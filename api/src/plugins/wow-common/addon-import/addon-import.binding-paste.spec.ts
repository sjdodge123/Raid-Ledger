import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddonWho } from '@raid-ledger/contract';
import type {
  AddonBindingCharacter,
  AddonBindingPayload,
} from './addon-import.binding';
import { bindEverySection } from './addon-import.binding-paste';

/** ROK-1737 (Codex P2) — a mixed paste binds every section, all-or-nothing. */

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const base = (
  JSON.parse(readFileSync(join(FIXTURES, 'char-normal.json'), 'utf8')) as {
    payload: AddonBindingPayload;
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
};
const section = (who: Partial<AddonWho> = {}, region = 1) => ({
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
});
