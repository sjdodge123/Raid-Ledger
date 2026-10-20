import type {
  AddonImportRulesetInferenceDto,
  AddonWho,
} from '@raid-ledger/contract';
import { decodeImportPaste } from './addon-import/addon-import.decoder';
import {
  FIXTURE_EXPORTED_AT,
  buildCharPayload,
  buildGuildPayload,
  buildImportString,
  buildMember,
  buildRaidPayload,
  buildWho,
} from './addon-import/testing/addon-fixture.builder';
import { pinExportClock } from './addon-import/testing/pin-export-clock';
import {
  buildRealmRulesetIndex,
  createFallbackRuleset,
  inferForPaste,
  inferRuleset,
  sortRealmRulesets,
} from './forever-realm-rulesets.helpers';

pinExportClock();

/** ROK-1739 §7.1 — the pure realm → ruleset lookup. */

const index = buildRealmRulesetIndex([
  { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
  { region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' },
  { region: 'us', realmName: 'Tale Spinner', ruleset: 'roleplaying' },
  { region: 'us', realmName: 'Last Stand', ruleset: 'hardcore' },
]);

/** A `who` on `realmName` (omitted when undefined) with the given ruleset. */
function whoOn(
  realmName: string | undefined,
  ruleset: AddonWho['ruleset'] = null,
): AddonWho {
  const base = buildWho({ ruleset });
  if (realmName === undefined) return base;
  return { ...base, raw: { ...base.raw, realmName } };
}

describe('inferRuleset (ROK-1739)', () => {
  it.each([
    ['Skyfall', 'normal'],
    ['Bloodmoon', 'pvp'],
    ['Tale Spinner', 'roleplaying'],
    ['Last Stand', 'hardcore'],
  ] as const)('U1–U4: realm %s maps to %s', (realm, ruleset) => {
    expect(inferRuleset(whoOn(realm), 'us', index)).toEqual({
      ruleset,
      realmName: realm,
      source: 'realm-map',
    });
  });

  it('U5: an unknown realm infers nothing', () => {
    expect(inferRuleset(whoOn('Nowhere'), 'us', index)).toBeNull();
  });

  it("U6: the export's own ruleset wins over a mapped realm", () => {
    expect(
      inferRuleset(whoOn('Bloodmoon', 'roleplaying'), 'us', index),
    ).toBeNull();
  });

  it('U7: an absent or blank realm name infers nothing', () => {
    expect(inferRuleset(whoOn(undefined), 'us', index)).toBeNull();
    expect(inferRuleset(whoOn('   '), 'us', index)).toBeNull();
  });

  it('U8: a row for another region does not match', () => {
    const eu = buildRealmRulesetIndex([
      { region: 'eu', realmName: 'Frostmane', ruleset: 'pvp' },
    ]);
    expect(inferRuleset(whoOn('Frostmane'), 'us', eu)).toBeNull();
    expect(inferRuleset(whoOn('Frostmane'), undefined, eu)).toBeNull();
    expect(inferRuleset(whoOn('Frostmane'), 'eu', eu)?.ruleset).toBe('pvp');
  });

  it('U9: realm names match after normalization; the raw text is reported', () => {
    expect(inferRuleset(whoOn('  bloodMOON '), 'us', index)).toEqual({
      ruleset: 'pvp',
      realmName: '  bloodMOON ',
      source: 'realm-map',
    });
    expect(inferRuleset(whoOn('Tale   Spinner'), 'us', index)?.ruleset).toBe(
      'roleplaying',
    );
  });
});

describe('createFallbackRuleset (ROK-1739 D6)', () => {
  it('U10: never falls back to Hardcore; passes a selectable ruleset through', () => {
    const at = (
      ruleset: AddonImportRulesetInferenceDto['ruleset'],
    ): AddonImportRulesetInferenceDto => ({
      ruleset,
      realmName: 'X',
      source: 'realm-map',
    });
    expect(createFallbackRuleset(at('hardcore'))).toBeUndefined();
    expect(createFallbackRuleset(at('pvp'))).toBe('pvp');
    expect(createFallbackRuleset(null)).toBeUndefined();
  });
});

describe('inferForPaste (ROK-1739)', () => {
  const OLDER = FIXTURE_EXPORTED_AT - 10;
  const guild = buildGuildPayload(
    Array.from({ length: 16 }, (_, i) => buildMember(i + 1)),
  );
  const raidStr = (realm: string, exportedAt: number) =>
    buildImportString({ ...buildRaidPayload(), who: whoOn(realm), exportedAt });

  it('U11: reads the char section (authoritative) even when another is newer', () => {
    const char = buildImportString({
      ...buildCharPayload(),
      who: whoOn('Bloodmoon'),
      exportedAt: OLDER,
    });
    const paste = decodeImportPaste(
      `${raidStr('Skyfall', FIXTURE_EXPORTED_AT)}\n${char}`,
    );
    expect(inferForPaste(paste, index)?.ruleset).toBe('pvp');
  });

  it('U11: without a char section, reads the NEWEST section', () => {
    const older = buildImportString({
      ...guild,
      who: whoOn('Bloodmoon'),
      exportedAt: OLDER,
    });
    const paste = decodeImportPaste(
      `${older}\n${raidStr('Tale Spinner', FIXTURE_EXPORTED_AT)}`,
    );
    expect(inferForPaste(paste, index)?.ruleset).toBe('roleplaying');
  });

  it("U11: the region comes from the section's client.region", () => {
    const eu = buildCharPayload({ who: whoOn('Bloodmoon') });
    const paste = decodeImportPaste(
      buildImportString({ ...eu, client: { ...eu.client, region: 3 } }),
    );
    expect(inferForPaste(paste, index)).toBeNull();
  });
});

describe('sortRealmRulesets (ROK-1739)', () => {
  it('orders by region, then normalized realm name', () => {
    const sorted = sortRealmRulesets({
      entries: [
        { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
        { region: 'eu', realmName: 'Frostmane', ruleset: 'pvp' },
        { region: 'us', realmName: 'bloodmoon', ruleset: 'pvp' },
      ],
    });
    expect(sorted.entries.map((e) => `${e.region}/${e.realmName}`)).toEqual([
      'eu/Frostmane',
      'us/bloodmoon',
      'us/Skyfall',
    ]);
  });
});
