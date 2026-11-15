/**
 * ROK-2184 — `addon_import_audit.envelope_version`: the pasted `!RLn!`
 * version reaches every audit write. Sniffed before decoding (reject rows),
 * overwritten by the decoded paste's version, carried by the finalising
 * UPDATE (`outcomeOf`) and copied onto a mixed paste's extra section rows.
 */
import type { AddonImportAuditInsert } from '../../../drizzle/schema';
import { outcomeOf } from './addon-import.audit';
import { decodeImportPaste } from './addon-import.decoder';
import {
  auditRow,
  finishAttempt,
  recordPasteFacts,
} from './addon-import.finish';
import {
  rawFacts,
  sniffEnvelopeVersion,
  type AttemptFacts,
} from './addon-import.service.helpers';
import {
  buildCharPayload,
  buildImportString,
} from './testing/addon-fixture.builder';
import { buildLootDrop, buildLootPayload } from './testing/addon-fixture.loot';
import { pinExportClock } from './testing/pin-export-clock';

pinExportClock();

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const v1Char = (): string => buildImportString(buildCharPayload());
const v2Loot = (): string =>
  buildImportString(buildLootPayload([buildLootDrop(0)]), { version: 2 });

function facts(overrides: Partial<AttemptFacts> = {}): AttemptFacts {
  return {
    sizeBytes: 10,
    dryRun: false,
    section: 'char',
    sha256: 'a'.repeat(64),
    auditId: null,
    sections: [],
    envelopeVersion: null,
    ...overrides,
  };
}

describe('sniffEnvelopeVersion', () => {
  it.each([
    ['!RL1!char!abc', 1],
    ['!RL2!loot!abc', 2],
    ['!RL7!char!abc', 7],
    ['  !RL2!guild-1of3!abc', 2],
  ])('%s → %i', (raw, version) => {
    expect(sniffEnvelopeVersion(raw)).toBe(version);
  });

  it.each([
    ['garbage', 'hello world'],
    ['a non-string', 42],
    ['no digits', '!RLx!char!abc'],
    ['an unknown section', '!RL2!bank!abc'],
    ['a version past smallint', '!RL99999!char!abc'],
  ])('%s → null', (_label, raw) => {
    expect(sniffEnvelopeVersion(raw)).toBeNull();
  });
});

describe('rawFacts', () => {
  it('records the sniffed version before anything is decoded', () => {
    const body = { importString: ' !RL2!char!zzz ', dryRun: false };
    expect(rawFacts(body).envelopeVersion).toBe(2);
  });

  it('records null when the body has no import string', () => {
    expect(rawFacts({}).envelopeVersion).toBeNull();
  });
});

describe('decodeImportPaste — version', () => {
  it('returns 1 for a v1 paste', () => {
    expect(decodeImportPaste(v1Char()).version).toBe(1);
  });

  it('returns 2 for a v2 paste', () => {
    expect(decodeImportPaste(v2Loot()).version).toBe(2);
  });
});

describe('recordPasteFacts + auditRow', () => {
  it('overwrites the sniffed version with the decoded one and maps it', () => {
    const f = facts({ envelopeVersion: 7 });
    recordPasteFacts(f, decodeImportPaste(v2Loot()));
    expect(f.envelopeVersion).toBe(2);
    expect(auditRow(1, null, f, 'applied').envelopeVersion).toBe(2);
  });
});

describe('outcomeOf (the finalising UPDATE)', () => {
  it('carries envelopeVersion onto the reserved row', () => {
    const row: AddonImportAuditInsert = {
      userId: 1,
      sizeBytes: 10,
      dryRun: false,
      result: 'applied',
      envelopeVersion: 2,
    };
    expect(outcomeOf(row)).toMatchObject({ envelopeVersion: 2 });
  });
});

describe('finishAttempt — mixed paste', () => {
  it('stamps the version on every section row', async () => {
    const recordSections = jest.fn().mockResolvedValue(undefined);
    const audit = { recordAttempt: jest.fn(), recordSections };
    const f = facts({
      envelopeVersion: 2,
      auditId: 41,
      sections: [
        { section: 'char', sha256: 'a'.repeat(64), sizeBytes: 5 },
        { section: 'loot', sha256: 'b'.repeat(64), sizeBytes: 5 },
      ],
    });
    await finishAttempt(audit, {
      userId: 1,
      characterId: null,
      facts: f,
      result: 'applied',
      perSection: ['applied', 'noop'],
    });
    const rows = must(
      recordSections.mock.calls[0],
      'recordSections call',
    )[0] as AddonImportAuditInsert[];
    expect(rows.map((r) => r.envelopeVersion)).toEqual([2, 2]);
  });
});
