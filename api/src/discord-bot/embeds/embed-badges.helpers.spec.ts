/**
 * ROK-1447 — TDD pins for the Quick Play badge helpers.
 *
 * These are the Discord-side mirrors of two web helpers, and the WHOLE point of
 * them is that the vocabulary can never drift between the two surfaces:
 *
 *   `coopBadge`  mirrors `web/src/lib/coop-label.ts::coopLabel`
 *   `priceBadge` mirrors `web/src/components/games/price-badge.helpers.ts::getPriceBadgeType`
 *
 * The co-op table below is a case-for-case port of `web/src/lib/coop-label.test.ts`
 * — if a case is changed here it must be changed there too, and vice versa.
 *
 * Differences from the web helpers, both forced by the data source:
 *   - inputs are raw `games` COLUMNS (`cooptimus_*`, `itad_*`), not DTOs, so the
 *     ITAD prices arrive as `numeric` → STRING and must be `Number()`-compared.
 *   - `priceBadge` takes an explicit `now` (ms) so the 24h staleness marker is
 *     testable without faking the clock.
 *
 * Spec: `planning-artifacts/specs/ROK-1447.md` §Files, AC3, AC4.
 */
import {
  coopBadge,
  priceBadge,
  type GameBadgeInputs,
} from './embed-badges.helpers';

/** U+2212 MINUS SIGN — the discount is a real minus, not a hyphen. */
const MINUS = '−';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Any fixed instant; every price case is expressed relative to it. */
const NOW = Date.parse('2026-09-02T12:00:00Z');

/** A game with no co-op claim and no ITAD row — the "nothing known" baseline. */
function game(overrides: Partial<GameBadgeInputs> = {}): GameBadgeInputs {
  return {
    isFreeToPlay: false,
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadPriceUpdatedAt: null,
    cooptimusOnlineMax: null,
    cooptimusCouchMax: null,
    cooptimusComboCoop: null,
    ...overrides,
  };
}

/** A discounted game, priced above its historical low → `On Sale`. */
function onSale(overrides: Partial<GameBadgeInputs> = {}): GameBadgeInputs {
  return game({
    itadCurrentPrice: '29.99',
    itadCurrentCut: 50,
    itadCurrentShop: 'Steam',
    itadCurrentUrl: 'https://store.example/deal',
    itadLowestPrice: '14.99',
    itadPriceUpdatedAt: new Date(NOW - HOUR_MS),
    ...overrides,
  });
}

// ─── coopBadge ───────────────────────────────────────────────────────────────

// ROK-1447 rework: the field NAME carries 👥, so the VALUE no longer repeats it
// — `👥 4 online co-op` became `4 online co-op`. The COPY is still `coopLabel`'s
// word for word; only the duplicate glyph came off. Pinned below in
// "the value carries the copy, not a second glyph".

describe('coopBadge — priority: combo beats online beats local', () => {
  it('labels a combo game "combo co-op" even when both counts qualify', () => {
    expect(
      coopBadge(
        game({
          cooptimusOnlineMax: 5,
          cooptimusCouchMax: 4,
          cooptimusComboCoop: true,
        }),
      ),
    ).toEqual({ name: '\u{1F465} Co-op', value: '5 combo co-op' });
  });

  it('labels a combo game "combo co-op" with only an online count', () => {
    // combo is Co-Optimus's own flag, not something we derive from the counts.
    expect(
      coopBadge(game({ cooptimusOnlineMax: 5, cooptimusComboCoop: true }))
        ?.value,
    ).toBe('5 combo co-op');
  });

  it('labels a combo game "combo co-op" with only a couch count', () => {
    expect(
      coopBadge(game({ cooptimusCouchMax: 4, cooptimusComboCoop: true }))
        ?.value,
    ).toBe('4 combo co-op');
  });

  it('falls to "online co-op" when the combo flag is false', () => {
    expect(
      coopBadge(
        game({
          cooptimusOnlineMax: 5,
          cooptimusCouchMax: 4,
          cooptimusComboCoop: false,
        }),
      )?.value,
    ).toBe('5 online co-op');
  });

  it('falls to "online co-op" when the combo flag is absent', () => {
    expect(
      coopBadge(game({ cooptimusOnlineMax: 5, cooptimusCouchMax: 4 }))?.value,
    ).toBe('5 online co-op');
  });

  it('prefers the ONLINE count over the couch count', () => {
    const badge = coopBadge(
      game({ cooptimusOnlineMax: 5, cooptimusCouchMax: 4 }),
    );
    expect(badge?.value).toContain('5');
    expect(badge?.value).not.toContain('4');
  });

  it('labels a couch-only game "local co-op" with the couch count', () => {
    expect(coopBadge(game({ cooptimusCouchMax: 2 }))?.value).toBe(
      '2 local co-op',
    );
  });

  it('treats a synced online ZERO as no online claim, so couch wins', () => {
    expect(
      coopBadge(game({ cooptimusOnlineMax: 0, cooptimusCouchMax: 4 }))?.value,
    ).toBe('4 local co-op');
  });
});

describe('coopBadge — a combo game with no usable count is label-only', () => {
  it('renders the bare label when both counts are absent', () => {
    expect(coopBadge(game({ cooptimusComboCoop: true }))?.value).toBe(
      'combo co-op',
    );
  });

  it('renders the bare label for a synced zero and a lone couch seat', () => {
    expect(
      coopBadge(
        game({
          cooptimusOnlineMax: 0,
          cooptimusCouchMax: 1,
          cooptimusComboCoop: true,
        }),
      )?.value,
    ).toBe('combo co-op');
  });
});

describe('coopBadge — thresholds are asymmetric', () => {
  it('counts an online max of 1 as an online claim', () => {
    expect(coopBadge(game({ cooptimusOnlineMax: 1 }))?.value).toBe(
      '1 online co-op',
    );
  });

  it('does NOT count a couch max of 1 as local co-op', () => {
    // One player on a sofa is single-player, not local co-op.
    expect(coopBadge(game({ cooptimusCouchMax: 1 }))).toBeNull();
  });

  it('counts a couch max of exactly 2 as local co-op (boundary)', () => {
    expect(coopBadge(game({ cooptimusCouchMax: 2 }))?.value).toBe(
      '2 local co-op',
    );
  });
});

describe('coopBadge — no claim renders no field at all', () => {
  it.each([
    ['both null', { cooptimusOnlineMax: null, cooptimusCouchMax: null }],
    [
      'both undefined',
      { cooptimusOnlineMax: undefined, cooptimusCouchMax: undefined },
    ],
    ['synced zeroes', { cooptimusOnlineMax: 0, cooptimusCouchMax: 0 }],
    ['online zero, couch one', { cooptimusOnlineMax: 0, cooptimusCouchMax: 1 }],
    ['negative values', { cooptimusOnlineMax: -1, cooptimusCouchMax: -4 }],
    ['NaN', { cooptimusOnlineMax: Number.NaN, cooptimusCouchMax: Number.NaN }],
    [
      'combo explicitly false with no counts',
      {
        cooptimusOnlineMax: 0,
        cooptimusCouchMax: 0,
        cooptimusComboCoop: false,
      },
    ],
    [
      'combo null with no counts',
      {
        cooptimusOnlineMax: null,
        cooptimusCouchMax: null,
        cooptimusComboCoop: null,
      },
    ],
  ])('returns null for %s', (_name, counts) => {
    expect(coopBadge(game(counts as Partial<GameBadgeInputs>))).toBeNull();
  });

  it('never consults an IGDB-style lobby size — a co-op claim is Co-Optimus only', () => {
    // Regression guard on the INPUT shape: a 100-player PvP lobby size cannot
    // promote a game to co-op because the helper reads cooptimus_* only.
    expect(
      coopBadge(
        game({ playerCount: 100 } as unknown as Partial<GameBadgeInputs>),
      ),
    ).toBeNull();
  });
});

describe('coopBadge — field name is fixed', () => {
  it('always names the field "👥 Co-op" whatever the kind', () => {
    const names = [
      coopBadge(game({ cooptimusOnlineMax: 4 })),
      coopBadge(game({ cooptimusCouchMax: 2 })),
      coopBadge(game({ cooptimusComboCoop: true })),
    ].map((b) => b?.name);
    expect(names).toEqual([
      '\u{1F465} Co-op',
      '\u{1F465} Co-op',
      '\u{1F465} Co-op',
    ]);
  });
});

describe('coopBadge — the value carries the copy, not a second glyph', () => {
  /**
   * The field NAME already shows 👥, so repeating it in the value renders the
   * glyph twice in one field. The mirrored copy still has to be `coopLabel`'s
   * word-for-word, though — otherwise the two surfaces drift, which is the
   * whole reason this helper exists. So: strip the LEADING glyph, keep the
   * text. The table is `coopLabel`'s own output, verbatim.
   */
  const MIRRORED: Array<[string, Partial<GameBadgeInputs>, string]> = [
    [
      'combo with a count',
      { cooptimusOnlineMax: 5, cooptimusComboCoop: true },
      '\u{1F465} 5 combo co-op',
    ],
    [
      'combo with no count',
      { cooptimusComboCoop: true },
      '\u{1F465} combo co-op',
    ],
    ['online', { cooptimusOnlineMax: 4 }, '\u{1F465} 4 online co-op'],
    ['local', { cooptimusCouchMax: 2 }, '\u{1F465} 2 local co-op'],
  ];

  it.each(MIRRORED)(
    'never starts the %s value with the glyph',
    (_n, counts) => {
      const value = coopBadge(game(counts))!.value;
      expect(value.startsWith('\u{1F465}')).toBe(false);
    },
  );

  it.each(MIRRORED)(
    'keeps the %s copy identical to coopLabel once the glyph is restored',
    (_n, counts, coopLabelOutput) => {
      // `web/src/lib/coop-label.ts::coopLabel` renders `coopLabelOutput`; the
      // badge value must be exactly that, minus the leading glyph and space.
      const value = coopBadge(game(counts))!.value;
      expect(`\u{1F465} ${value}`).toBe(coopLabelOutput);
    },
  );

  it('leaves the glyph on the field NAME, where it belongs', () => {
    expect(coopBadge(game({ cooptimusOnlineMax: 4 }))!.name).toBe(
      '\u{1F465} Co-op',
    );
  });
});

// ─── priceBadge ──────────────────────────────────────────────────────────────

describe('priceBadge — when there is nothing to advertise', () => {
  it('returns null when the game has no ITAD row at all', () => {
    expect(priceBadge(game(), NOW)).toBeNull();
  });

  it('returns null when the current cut is zero', () => {
    expect(priceBadge(onSale({ itadCurrentCut: 0 }), NOW)).toBeNull();
  });

  it('returns null when the current cut is negative', () => {
    expect(priceBadge(onSale({ itadCurrentCut: -5 }), NOW)).toBeNull();
  });

  it('returns null when the current cut is null', () => {
    expect(priceBadge(onSale({ itadCurrentCut: null }), NOW)).toBeNull();
  });

  it('returns null when there is a cut but no current price', () => {
    expect(priceBadge(onSale({ itadCurrentPrice: null }), NOW)).toBeNull();
  });

  it('returns null for a free-to-play game even with a live discount', () => {
    // A discount on a game that costs nothing is noise, not news.
    expect(priceBadge(onSale({ isFreeToPlay: true }), NOW)).toBeNull();
  });
});

describe('priceBadge — best price versus on sale', () => {
  it('names the field "🏷 On Sale" when priced above the historical low', () => {
    expect(priceBadge(onSale(), NOW)?.name).toBe('\u{1F3F7} On Sale');
  });

  it('names the field "🏷 Best Price" when the price EQUALS the historical low', () => {
    expect(
      priceBadge(
        onSale({ itadCurrentPrice: '14.99', itadLowestPrice: '14.99' }),
        NOW,
      )?.name,
    ).toBe('\u{1F3F7} Best Price');
  });

  it('names the field "🏷 Best Price" when the price is BELOW the historical low', () => {
    expect(
      priceBadge(
        onSale({ itadCurrentPrice: '9.99', itadLowestPrice: '14.99' }),
        NOW,
      )?.name,
    ).toBe('\u{1F3F7} Best Price');
  });

  it('falls back to "🏷 On Sale" when no historical low is recorded', () => {
    expect(priceBadge(onSale({ itadLowestPrice: null }), NOW)?.name).toBe(
      '\u{1F3F7} On Sale',
    );
  });

  it('compares the numeric prices, not the numeric-as-string columns', () => {
    // '9.99' > '14.99' as STRINGS; the badge must still read best-price.
    expect(
      priceBadge(
        onSale({ itadCurrentPrice: '9.99', itadLowestPrice: '14.99' }),
        NOW,
      )?.name,
    ).toBe('\u{1F3F7} Best Price');
  });
});

describe('priceBadge — value is a masked link to the deal', () => {
  it('renders "−{cut}% · $X.XX" linked to the current ITAD URL', () => {
    expect(priceBadge(onSale(), NOW)?.value).toBe(
      `[${MINUS}50% · $29.99](https://store.example/deal)`,
    );
  });

  it('renders the price to two decimals whatever the column carries', () => {
    expect(priceBadge(onSale({ itadCurrentPrice: '7' }), NOW)?.value).toContain(
      '$7.00',
    );
  });

  it('renders unlinked plain text when the ITAD URL is missing', () => {
    const value = priceBadge(onSale({ itadCurrentUrl: null }), NOW)?.value;
    expect(value).toBe(`${MINUS}50% · $29.99`);
  });
});

describe('priceBadge — the 24h staleness marker', () => {
  it('carries no marker for a price checked an hour ago', () => {
    expect(priceBadge(onSale(), NOW)?.value).not.toContain('checked');
  });

  it('carries no marker at exactly 24h — the rule is OLDER than 24h', () => {
    const value = priceBadge(
      onSale({ itadPriceUpdatedAt: new Date(NOW - DAY_MS) }),
      NOW,
    )?.value;
    expect(value).not.toContain('checked');
  });

  it('appends "⚠ checked 3 days ago" for a price checked three days ago', () => {
    const value = priceBadge(
      onSale({ itadPriceUpdatedAt: new Date(NOW - 3 * DAY_MS) }),
      NOW,
    )?.value;
    expect(value).toContain('⚠ checked 3 days ago');
  });

  it('keeps the deal link in front of the staleness marker', () => {
    const value = priceBadge(
      onSale({ itadPriceUpdatedAt: new Date(NOW - 3 * DAY_MS) }),
      NOW,
    )!.value;
    expect(value.startsWith('[')).toBe(true);
    expect(value.endsWith('ago')).toBe(true);
    expect(value.indexOf('](https://store.example/deal)')).toBeLessThan(
      value.indexOf('checked'),
    );
  });

  it('counts WHOLE days — 47h old is still one day stale, never zero', () => {
    const value = priceBadge(
      onSale({ itadPriceUpdatedAt: new Date(NOW - 47 * HOUR_MS) }),
      NOW,
    )!.value;
    expect(value).toContain('checked 1 day');
    expect(value).not.toContain('checked 0 ');
  });

  it('carries no marker when the timestamp is missing entirely', () => {
    // No `itad_price_updated_at` is "unknown age", not "known to be stale" —
    // marking it would put a warning on every freshly imported row.
    expect(
      priceBadge(onSale({ itadPriceUpdatedAt: null }), NOW)?.value,
    ).not.toContain('checked');
  });

  it('is driven by `now`, not the wall clock', () => {
    const fixed = onSale({ itadPriceUpdatedAt: new Date(NOW - 3 * DAY_MS) });
    expect(priceBadge(fixed, NOW)?.value).toContain('checked 3 days ago');
    expect(priceBadge(fixed, NOW - 2 * DAY_MS)?.value).not.toContain('checked');
  });
});
