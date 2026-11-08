import { Logger } from '@nestjs/common';
import { setForeverNamespacePrefix } from '../forever-namespace.resolver';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { WowFactsService } from './wow-facts.service';
import {
  MAX_ROSTER_ROWS,
  type RosterCharRef,
  type WowFactCandidates,
  type WowFactSource,
} from './wow-fact.types';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 3600 * 1000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const REF: RosterCharRef = { key: 'm1', memberId: 1, characterId: 'c1' };

function fakeSource(
  id: WowFactSource['id'],
  facts: WowFactCandidates,
): WowFactSource & { load: jest.Mock } {
  return {
    id,
    fields: ['level'],
    load: jest.fn((refs: RosterCharRef[]) =>
      Promise.resolve(new Map(refs.map((r) => [r.key, facts]))),
    ),
  };
}

afterEach(() => setForeverNamespacePrefix(null));

/** `prefix` is the EFFECTIVE Forever prefix (ROK-1920 seam). */
function build(prefix: string | null) {
  setForeverNamespacePrefix(prefix);
  const roster = fakeSource('roster', {
    level: { value: 58, source: 'roster', asOf: ago(3 * HOUR) },
  });
  const addon = fakeSource('addon', {
    level: { value: 59, source: 'addon', asOf: ago(HOUR) },
  });
  const chars = fakeSource('manual', {});
  const settings = { get: jest.fn().mockResolvedValue(prefix) };
  const service = new WowFactsService(
    roster as never,
    addon as never,
    chars as never,
    settings as never,
    {} as never,
  );
  return { service, roster, addon, chars, settings };
}

describe('WowFactsService — Blizzard registration seam', () => {
  const blizzardAt = (asOf: Date) =>
    fakeSource('blizzard', {
      level: { value: 60, source: 'blizzard', asOf },
    });

  it('a registered fake blizzard source wins (live namespace)', async () => {
    const { service, settings } = build('classicforever1');
    service.registerBlizzardSource(blizzardAt(ago(20 * HOUR)));
    const got = await service.resolveFacts([REF]);
    expect(got.facts.get('m1')?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(20 * HOUR),
    });
    expect(settings.get).toHaveBeenCalledWith(WOW_FOREVER_ARMORY_IMPORT_KEY);
  });

  // ROK-2138: Blizzard wins regardless of age; the addon only fills gaps.
  it('a 30-day-old blizzard value still beats a newer addon value', async () => {
    const { service } = build('classicforever1');
    service.registerBlizzardSource(blizzardAt(ago(30 * 24 * HOUR)));
    const got = await service.resolveFacts([REF]);
    expect(got.facts.get('m1')?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(30 * 24 * HOUR),
    });
  });

  // Since ROK-2102 step 2 (#1979) the default prefix resolves to `forever`,
  // so with the default prefix the Armory switch alone decides the seam.
  it('with the default prefix: consulted while the switch is on, not while it is off', async () => {
    const on = build(null);
    const live = blizzardAt(NOW);
    on.service.registerBlizzardSource(live);
    const gotOn = await on.service.resolveFacts([REF]);
    expect(live.load).toHaveBeenCalledTimes(1);
    expect(gotOn.facts.get('m1')?.level?.source).toBe('blizzard');

    const off = build(null);
    off.settings.get.mockResolvedValue('false');
    const idle = blizzardAt(NOW);
    off.service.registerBlizzardSource(idle);
    const gotOff = await off.service.resolveFacts([REF]);
    expect(idle.load).not.toHaveBeenCalled();
    expect(gotOff.facts.get('m1')?.level?.source).toBe('addon');
  });

  it('no blizzard source is registered by default', async () => {
    const { service } = build('classicforever1');
    expect((await service.activeSources()).map((s) => s.id)).toEqual([
      'roster',
      'addon',
      'manual',
    ]);
  });

  it('rejects a source that is not blizzard', () => {
    const { service } = build(null);
    expect(() =>
      service.registerBlizzardSource(fakeSource('addon', {})),
    ).toThrow();
  });
});

describe('WowFactsService.resolveFacts — batching', () => {
  it('calls each source once per batch and caps it at MAX_ROSTER_ROWS', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, roster, addon, chars } = build(null);
    const refs = Array.from({ length: MAX_ROSTER_ROWS + 5 }, (_, i) => ({
      key: `m${i}`,
      memberId: i,
      characterId: null,
    }));
    const got = await service.resolveFacts(refs);
    for (const s of [roster, addon, chars]) {
      expect(s.load).toHaveBeenCalledTimes(1);
      expect(s.load.mock.calls[0]?.[0]).toHaveLength(MAX_ROSTER_ROWS);
    }
    expect(got.facts.size).toBe(MAX_ROSTER_ROWS);
    expect(got.truncated).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('resolves a row no source knows to all-unknown facts', async () => {
    const { service, roster, addon } = build(null);
    roster.load.mockResolvedValue(new Map());
    addon.load.mockResolvedValue(new Map());
    const got = await service.resolveFacts([REF]);
    expect(got.facts.get('m1')?.level).toBeNull();
  });
});

describe('WowFactsService — a stored Armory row wins with or without the seam (ROK-2138 OQ-1)', () => {
  /** A CharacterRow-style Armory row: blizzard-labelled, synced 10 days ago. */
  function withArmoryRow(prefix: string | null) {
    const ctx = build(prefix);
    ctx.chars.load.mockResolvedValue(
      new Map([
        [
          'm1',
          { level: { value: 60, source: 'blizzard', asOf: ago(240 * HOUR) } },
        ],
      ]),
    );
    return ctx;
  }

  it('seam off: the 10-day-old blizzard-labelled row beats a newer addon snapshot (AC7)', async () => {
    const { service, settings } = withArmoryRow(null);
    settings.get.mockResolvedValue('false');
    service.registerBlizzardSource(fakeSource('blizzard', {}));
    const got = await service.resolveFacts([REF]);
    expect((await service.activeSources()).map((s) => s.id)).not.toContain(
      'blizzard',
    );
    expect(got.facts.get('m1')?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(240 * HOUR),
    });
  });

  it('seam on: the blizzard fact wins', async () => {
    const { service } = withArmoryRow('classicforever1');
    service.registerBlizzardSource(fakeSource('blizzard', {}));
    const got = await service.resolveFacts([REF]);
    expect(got.facts.get('m1')?.level?.source).toBe('blizzard');
  });

  it('no blizzard value anywhere: the newer addon snapshot fills the gap (AC8)', async () => {
    const { service } = build(null);
    const got = await service.resolveFacts([REF]);
    expect(got.facts.get('m1')?.level).toEqual({
      value: 59,
      source: 'addon',
      asOf: ago(HOUR),
    });
  });

  it('a roster row with no character and no Blizzard row resolves from the roster (AC9)', async () => {
    const { service, addon } = build(null);
    addon.load.mockResolvedValue(new Map());
    const got = await service.resolveFacts([
      { key: 'm1', memberId: 1, characterId: null },
    ]);
    expect(got.facts.get('m1')?.level).toEqual({
      value: 58,
      source: 'roster',
      asOf: ago(3 * HOUR),
    });
  });

  it('a small batch is not truncated', async () => {
    const { service } = build(null);
    expect((await service.resolveFacts([REF])).truncated).toBe(false);
  });
});
