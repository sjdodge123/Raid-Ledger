import { Logger } from '@nestjs/common';
import { WOW_FOREVER_NAMESPACE_PREFIX_KEY } from '../forever.settings';
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

function build(prefix: string | null) {
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

  it('a registered fake blizzard source wins while fresh (live namespace)', async () => {
    const { service, settings } = build('classicforever1');
    service.registerBlizzardSource(blizzardAt(ago(20 * HOUR)));
    const got = await service.resolveFacts([REF], NOW);
    expect(got.facts.get('m1')?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(20 * HOUR),
    });
    expect(settings.get).toHaveBeenCalledWith(WOW_FOREVER_NAMESPACE_PREFIX_KEY);
  });

  it('a stale blizzard value loses to a newer addon value', async () => {
    const { service } = build('classicforever1');
    service.registerBlizzardSource(blizzardAt(ago(30 * HOUR)));
    const got = await service.resolveFacts([REF], NOW);
    expect(got.facts.get('m1')?.level?.source).toBe('addon');
  });

  it('is not consulted while the namespace is the default alias', async () => {
    const { service } = build(null);
    const blizzard = blizzardAt(NOW);
    service.registerBlizzardSource(blizzard);
    const got = await service.resolveFacts([REF], NOW);
    expect(blizzard.load).not.toHaveBeenCalled();
    expect(got.facts.get('m1')?.level?.source).toBe('addon');
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
    const got = await service.resolveFacts(refs, NOW);
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
    const got = await service.resolveFacts([REF], NOW);
    expect(got.facts.get('m1')?.level).toBeNull();
  });
});

describe('WowFactsService — fresh-blizzard override needs the registered seam', () => {
  /** A CharacterRow-style Armory row: blizzard-labelled, synced 2h ago. */
  function withArmoryRow(prefix: string | null) {
    const ctx = build(prefix);
    ctx.chars.load.mockResolvedValue(
      new Map([
        [
          'm1',
          { level: { value: 60, source: 'blizzard', asOf: ago(2 * HOUR) } },
        ],
      ]),
    );
    return ctx;
  }

  it('seam off: a recent blizzard-labelled row loses to a newer addon snapshot', async () => {
    const { service } = withArmoryRow('classicforever1');
    const got = await service.resolveFacts([REF], NOW);
    expect(got.facts.get('m1')?.level?.source).toBe('addon');
  });

  it('seam on: the fresh blizzard fact wins', async () => {
    const { service } = withArmoryRow('classicforever1');
    service.registerBlizzardSource(fakeSource('blizzard', {}));
    const got = await service.resolveFacts([REF], NOW);
    expect(got.facts.get('m1')?.level?.source).toBe('blizzard');
  });

  it('a small batch is not truncated', async () => {
    const { service } = build(null);
    expect((await service.resolveFacts([REF], NOW)).truncated).toBe(false);
  });
});
