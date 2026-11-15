/**
 * ROK-2184 ruling Q5 — the loot dedup key's pure pieces: the 120 s `at`
 * bucket, the looter key (`looterGuid ?? looterName`), the in-payload +
 * stored dedup count the preview reports, the stored row, and the guild
 * keys a paste locks (`guildLockKeys`).
 */
import type { AddonApplyContext } from './addon-import-apply.types';
import type { DecodedAddonPaste } from './addon-import.decoder';
import {
  countNewDrops,
  lootAtBucket,
  lootDropRow,
  lootDropRows,
  lootKeyOfDrop,
  lootKeyString,
  lootLooterKey,
} from './addon-import-loot.keys';
import { guildLockKeys } from './addon-import.locks';
import { buildLootDrop, buildLootPayload } from './testing/addon-fixture.loot';

describe('lootAtBucket', () => {
  it('floors unix seconds to 120 s buckets', () => {
    expect(lootAtBucket(1_200_000)).toBe(10_000);
    expect(lootAtBucket(1_200_119)).toBe(10_000);
    expect(lootAtBucket(1_200_120)).toBe(10_001);
    expect(lootAtBucket(1_199_999)).toBe(9_999);
  });
});

describe('lootLooterKey', () => {
  it('prefers the GUID over the name', () => {
    expect(
      lootLooterKey({ looterName: 'Lootero', looterGuid: 'Player-1-0000000A' }),
    ).toBe('Player-1-0000000A');
  });

  it('falls back to the NFC-normalised, trimmed name', () => {
    expect(lootLooterKey({ looterName: '  Lootera-Testrealm ' })).toBe(
      'Lootera-Testrealm',
    );
    expect(lootLooterKey({ looterName: 'Löotera' })).toBe('Löotera');
  });
});

describe('countNewDrops', () => {
  const base = buildLootDrop(0, { at: 1_200_000 });

  it('collapses same-key drops inside one bucket and counts the first only', () => {
    const twin = { ...base, at: base.at + 119, link: 'other link' };
    expect(countNewDrops([base, twin], new Set())).toBe(1);
  });

  it('keeps drops apart on bucket, quantity, item, looter or instance', () => {
    const drops = [
      base,
      { ...base, at: base.at + 120 },
      { ...base, quantity: 2 },
      { ...base, itemId: base.itemId + 1 },
      { ...base, looterGuid: 'Player-1-0000000B' },
      { ...base, instanceId: 410 },
    ];
    expect(countNewDrops(drops, new Set())).toBe(6);
  });

  it('treats a missing instanceId as its own key value', () => {
    const { instanceId: _omit, ...noInstance } = base;
    void _omit;
    expect(countNewDrops([noInstance, noInstance, base], new Set())).toBe(2);
  });

  it('skips drops whose key is already stored', () => {
    const stored = new Set([lootKeyString(lootKeyOfDrop(base))]);
    const other = buildLootDrop(1, { at: base.at });
    expect(countNewDrops([base, other], stored)).toBe(1);
  });

  it('a stored row and a sent drop produce the same key string', () => {
    const k = lootKeyOfDrop(base);
    expect(lootKeyString({ ...k })).toBe(lootKeyString(k));
    expect(lootKeyString({ ...k, instanceId: null })).not.toBe(
      lootKeyString(k),
    );
  });
});

describe('lootDropRow', () => {
  const ctx = {
    userId: 3,
    characterId: 'c-1',
    gameId: 7,
    region: 'us',
    sha256: 'a'.repeat(64),
  } as AddonApplyContext;

  it('stores the dedup columns, the guild key and the audit reference', () => {
    const drop = buildLootDrop(0, { at: 1_200_100 });
    const payload = buildLootPayload([drop]);
    const row = lootDropRow(drop, payload, ctx);
    expect(row).toMatchObject({
      gameId: 7,
      region: 'us',
      guildKey: (payload.who.guildName ?? '').trim().toLowerCase(),
      looterKey: drop.looterGuid,
      itemId: drop.itemId,
      quantity: 1,
      atBucket: 10_000,
      instanceId: 409,
      droppedAt: new Date(1_200_100_000),
      reportedByUserId: 3,
      reportedByCharacterId: 'c-1',
      payloadSha256: 'a'.repeat(64),
    });
  });

  it('nulls absent optional fields', () => {
    const drop = {
      at: 1_200_000,
      itemId: 5,
      quantity: 1,
      looterName: 'X',
      method: 'direct' as const,
    };
    const row = lootDropRow(drop, buildLootPayload([drop]), ctx);
    expect(row).toMatchObject({
      looterKey: 'X',
      looterGuid: null,
      instanceId: null,
      encounterId: null,
      link: null,
      quality: null,
    });
  });

  it('lootDropRows sorts rows by dedup key, whatever the payload order', () => {
    const drops = [3, 0, 2, 1].map((i) =>
      buildLootDrop(i, { looterName: `L${i}`, looterGuid: `G-${3 - i}` }),
    );
    const rows = lootDropRows(drops, buildLootPayload(drops), ctx);
    const keys = rows.map((r) =>
      lootKeyString({ ...r, instanceId: r.instanceId ?? null }),
    );
    expect(keys).toEqual([...keys].sort());
    expect(rows.map((r) => r.looterKey)).toEqual(['G-0', 'G-1', 'G-2', 'G-3']);
    const reversed = lootDropRows(
      [...drops].reverse(),
      buildLootPayload(drops),
      ctx,
    );
    expect(reversed.map((r) => r.itemId)).toEqual(rows.map((r) => r.itemId));
  });

  it("lootDropRows keeps a payload's duplicate keys in payload order (first copy wins)", () => {
    const first = buildLootDrop(0, { quality: 3 });
    const second = buildLootDrop(0, { quality: 4 });
    const rows = lootDropRows([first, second], buildLootPayload([first]), ctx);
    expect(rows.map((r) => r.quality)).toEqual([3, 4]);
  });
});

describe('guildLockKeys', () => {
  function paste(guildName: string | null, lootGuild: string | null) {
    const sections: Record<string, unknown> = {};
    if (guildName !== null)
      sections.guild = { payload: { data: { name: guildName } } };
    if (lootGuild !== null)
      sections.loot = { payload: { who: { guildName: lootGuild } } };
    return {
      sections,
      order: [],
      tokens: 1,
      inputBytes: 1,
    } as unknown as DecodedAddonPaste;
  }

  it('locks the guild section name alone when there is no loot', () => {
    expect(guildLockKeys(paste(' Night Shift ', null))).toEqual([
      'night shift',
    ]);
  });

  it('a loot-only paste locks its exporter guild key', () => {
    expect(guildLockKeys(paste(null, 'Night Shift'))).toEqual(['night shift']);
  });

  it('takes one lock when guild and loot name the same guild', () => {
    expect(guildLockKeys(paste('Night Shift', 'night shift'))).toEqual([
      'night shift',
    ]);
  });

  it('takes both in sorted order when they differ', () => {
    expect(guildLockKeys(paste('Zeta', 'Alpha'))).toEqual(['alpha', 'zeta']);
  });

  it('an unguilded loot export locks nothing', () => {
    expect(guildLockKeys(paste(null, ''))).toEqual([]);
  });
});
