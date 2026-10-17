/**
 * ROK-1756 — the export-time bound reads an injectable clock, so the golden
 * fixtures (dated 2026-09-21) are not a time bomb: a spec that pins the clock
 * still decodes them when the real clock reads 2030, while the 24 h future /
 * 1-year age bounds keep rejecting relative to whatever clock is injected.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT_TIME_MESSAGE, exportClock } from './addon-import.clock';
import { decodeImportPaste, decodeImportString } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  buildCharPayload,
  buildImportString,
  FIXTURE_EXPORTED_AT,
} from './testing/addon-fixture.builder';
import { pinExportClock } from './testing/pin-export-clock';

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
const GOLDEN = readdirSync(FIXTURES).filter((f) => f.endsWith('.txt'));
const YEAR_2030_MS = Date.UTC(2030, 0, 1);
const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;
const charString = buildImportString(buildCharPayload());
const at = (offsetS: number) => (FIXTURE_EXPORTED_AT + offsetS) * 1000;

/** The rejection message, or `'decoded'` when the decode succeeds. */
function outcome(decode: () => unknown): string {
  try {
    decode();
    return 'decoded';
  } catch (err) {
    if (!(err instanceof AddonImportError)) throw err;
    return `${err.code}: ${err.body.message}`;
  }
}
const REJECTED = `INVALID_PAYLOAD: ${EXPORT_TIME_MESSAGE}`;

describe('pinned clock — golden fixtures survive a 2030 wall clock', () => {
  pinExportClock();
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(YEAR_2030_MS));
  afterEach(() => jest.restoreAllMocks());

  it('found the golden fixtures', () => {
    expect(GOLDEN.length).toBeGreaterThan(0);
  });

  it.each(GOLDEN)('%s decodes', (file) => {
    const raw = readFileSync(join(FIXTURES, file), 'utf8');
    expect(outcome(() => decodeImportPaste(raw))).toBe('decoded');
  });
});

describe('the bounds hold relative to the injected clock', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a fixture when the injected clock reads 2030', () => {
    expect(outcome(() => decodeImportString(charString, YEAR_2030_MS))).toBe(
      REJECTED,
    );
  });

  it('defaults to exportClock — a 2030 exportClock rejects', () => {
    jest.spyOn(exportClock, 'nowMs').mockReturnValue(YEAR_2030_MS);
    expect(outcome(() => decodeImportString(charString))).toBe(REJECTED);
  });

  it('1-year age bound: 364 days old decodes, 366 days old is rejected', () => {
    expect(outcome(() => decodeImportString(charString, at(364 * DAY_S)))).toBe(
      'decoded',
    );
    expect(outcome(() => decodeImportString(charString, at(366 * DAY_S)))).toBe(
      REJECTED,
    );
  });

  it('24 h future bound: 23 h ahead decodes, 25 h ahead is rejected', () => {
    expect(
      outcome(() => decodeImportString(charString, at(-23 * HOUR_S))),
    ).toBe('decoded');
    expect(
      outcome(() => decodeImportString(charString, at(-25 * HOUR_S))),
    ).toBe(REJECTED);
  });
});
