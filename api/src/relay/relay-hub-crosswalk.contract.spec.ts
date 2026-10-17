/**
 * ROK-1667 (RH-1a) — relay hub v1 crosswalk contribution schemas (AC3).
 *
 * Contributions are writer-side, hub-validated requests: `.strict()` so a
 * non-id key is a 400 rather than silently stripped ("id mappings only"),
 * at least one strong id (D7: name-only games are rejected), and exactly
 * one provenance entry per id sent (D15). Imports go through
 * `@raid-ledger/contract`, which jest maps to the contract's src barrel.
 */
import {
  CrosswalkContributionBatchSchema,
  CrosswalkContributionItemSchema,
} from '@raid-ledger/contract';

const ONE_STRONG_ID = 'at least one strong id';
const ONE_PROVENANCE_PER_ID =
  'one provenance per id sent, and none without its id';

/** A valid item: IGDB id from IGDB, Steam app id from Steam itself. */
const VALID_ITEM = {
  clientRef: '42',
  name: "Baldur's Gate 3",
  igdbId: 119171,
  steamAppId: 1086940,
  provenance: { igdbId: 'igdb', steamAppId: 'steam' },
};

/** RFC 9562 v7-style uuid (version nibble 7, variant nibble b). */
const ITAD_UUID = '01890a5d-ac96-774b-bcce-b302099a8057';

const FAILING_ITEMS: Array<[string, Record<string, unknown>, object]> = [
  [
    'carries summary (strict)',
    { ...VALID_ITEM, summary: 'An RPG' },
    { code: 'unrecognized_keys', keys: ['summary'] },
  ],
  [
    'carries coverUrl (strict)',
    { ...VALID_ITEM, coverUrl: 'https://example.test/c.jpg' },
    { code: 'unrecognized_keys', keys: ['coverUrl'] },
  ],
  [
    'carries igdbSlug (strict)',
    { ...VALID_ITEM, igdbSlug: 'baldurs-gate-3' },
    { code: 'unrecognized_keys', keys: ['igdbSlug'] },
  ],
  [
    'has no igdbId, steamAppId or itadUuid (D7, name-only)',
    { clientRef: '43', name: 'Homebrew Night', provenance: {} },
    { message: ONE_STRONG_ID },
  ],
  [
    'has an id with no matching provenance entry',
    { ...VALID_ITEM, itadUuid: ITAD_UUID },
    { message: ONE_PROVENANCE_PER_ID },
  ],
  [
    'has a provenance entry with no matching id',
    {
      ...VALID_ITEM,
      provenance: { ...VALID_ITEM.provenance, itadUuid: 'itad' },
    },
    { message: ONE_PROVENANCE_PER_ID },
  ],
];

function batchOf(size: number) {
  return {
    items: Array.from({ length: size }, (_, n) => ({
      ...VALID_ITEM,
      clientRef: String(n),
    })),
  };
}

describe('CrosswalkContributionItemSchema (AC3)', () => {
  it('accepts an item whose every id has its provenance', () => {
    expect(CrosswalkContributionItemSchema.safeParse(VALID_ITEM)).toEqual({
      success: true,
      data: VALID_ITEM,
    });
  });

  it.each(FAILING_ITEMS)('rejects an item that %s', (_label, item, issue) => {
    const result = CrosswalkContributionItemSchema.safeParse(item);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining(issue)]),
    );
  });

  it("degrades an unrecognised provenance value such as 'bogus' to 'unknown' (D15)", () => {
    const item = {
      ...VALID_ITEM,
      provenance: { igdbId: 'bogus', steamAppId: 'steam' },
    };

    const result = CrosswalkContributionItemSchema.safeParse(item);

    expect(result.success).toBe(true);
    expect(result.data?.provenance).toEqual({
      igdbId: 'unknown',
      steamAppId: 'steam',
    });
  });
});

describe('CrosswalkContributionBatchSchema (AC3)', () => {
  it('accepts a batch of 100 items and defaults schemaVersion to 1', () => {
    const result = CrosswalkContributionBatchSchema.safeParse(batchOf(100));

    expect(result.success).toBe(true);
    expect(result.data?.items).toHaveLength(100);
    expect(result.data?.schemaVersion).toBe(1);
  });

  it('rejects a batch of 101 items', () => {
    const result = CrosswalkContributionBatchSchema.safeParse(batchOf(101));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'too_big',
        maximum: 100,
        path: ['items'],
      }),
    ]);
  });
});
