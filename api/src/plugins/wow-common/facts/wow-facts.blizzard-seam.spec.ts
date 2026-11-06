/**
 * ROK-1920 — the Blizzard Forever seam in WowFactsService: the source is
 * consulted only when the EFFECTIVE prefix is past the alias AND the Armory
 * switch is on; while live it shadows the row source's blizzard-labelled
 * copies of exactly the fields it answered (F6).
 */
import {
  FOREVER_NAMESPACE_ALIAS,
  setForeverNamespacePrefix,
} from '../forever-namespace.resolver';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { dropShadowedBlizzard } from './fact-source.helpers';
import { WowFactsService } from './wow-facts.service';
import type {
  RosterCharRef,
  WowFactCandidates,
  WowFactSource,
} from './wow-fact.types';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
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

/** The row source of an Armory-linked Forever row (blizzard-labelled). */
const ROW: WowFactCandidates = {
  level: { value: 61, source: 'blizzard', asOf: ago(30 * MIN) },
  class: { value: 'Warrior', source: 'blizzard', asOf: ago(30 * MIN) },
  role: { value: 'healer', source: 'manual', asOf: null },
};

interface Opts {
  prefix: string | null;
  switchValue?: string | null;
  blizzard: WowFactCandidates;
  addon?: WowFactCandidates;
}

function build(o: Opts) {
  setForeverNamespacePrefix(o.prefix);
  const blizzard = fakeSource('blizzard', o.blizzard);
  const rows = fakeSource('manual', ROW);
  const settings = {
    get: jest.fn((key: string) =>
      Promise.resolve(
        key === WOW_FOREVER_ARMORY_IMPORT_KEY
          ? (o.switchValue ?? null)
          : 'forever',
      ),
    ),
  };
  const service = new WowFactsService(
    fakeSource('roster', {}) as never,
    fakeSource('addon', o.addon ?? {}) as never,
    rows as never,
    settings as never,
    {} as never,
    blizzard as never,
  );
  return { service, blizzard, rows };
}

const resolve = async (service: WowFactsService) =>
  (await service.resolveFacts([REF], NOW)).facts.get('m1');

afterEach(() => setForeverNamespacePrefix(null));

describe('WowFactsService — Blizzard Forever seam liveness', () => {
  const level60: WowFactCandidates = {
    level: { value: 60, source: 'blizzard', asOf: ago(HOUR) },
  };

  it('live (effective prefix forever, switch on): the constructed source is active', async () => {
    const { service } = build({ prefix: 'forever', blizzard: level60 });
    expect((await service.activeSources()).map((s) => s.id)).toContain(
      'blizzard',
    );
  });

  it.each<[string, string | null]>([
    ['null (alias)', null],
    ['the explicit alias', FOREVER_NAMESPACE_ALIAS],
  ])(
    'effective prefix %s → not consulted, even with a stored "forever"',
    async (_l, prefix) => {
      const { service, blizzard } = build({ prefix, blizzard: level60 });
      expect((await service.activeSources()).map((s) => s.id)).not.toContain(
        'blizzard',
      );
      await service.resolveFacts([REF], NOW);
      expect(blizzard.load).not.toHaveBeenCalled();
    },
  );

  it("switch 'false' → not consulted and the row source's class/level are untouched", async () => {
    const { service, blizzard } = build({
      prefix: 'forever',
      switchValue: 'false',
      blizzard: level60,
    });
    const got = await resolve(service);
    expect(blizzard.load).not.toHaveBeenCalled();
    expect(got?.level).toEqual(ROW.level);
    expect(got?.class).toEqual(ROW.class);
  });

  it("a legacy 'true' switch keeps the seam live", async () => {
    const { service } = build({
      prefix: 'forever',
      switchValue: 'true',
      blizzard: level60,
    });
    expect((await service.activeSources()).map((s) => s.id)).toContain(
      'blizzard',
    );
  });
});

describe('WowFactsService — live seam shadows only answered fields (F6)', () => {
  it("drops the row's blizzard level (newer 61) for the source's 60, keeps the unanswered class", async () => {
    const { service } = build({
      prefix: 'forever',
      blizzard: { level: { value: 60, source: 'blizzard', asOf: ago(HOUR) } },
    });
    const got = await resolve(service);
    expect(got?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(HOUR),
    });
    expect(got?.class).toEqual(ROW.class);
  });

  it("keeps the row's manual role override when the source answered role", async () => {
    const { service } = build({
      prefix: 'forever',
      blizzard: { role: { value: 'dps', source: 'blizzard', asOf: ago(HOUR) } },
    });
    expect((await resolve(service))?.role).toEqual(ROW.role);
  });

  it('a source with no entry for the row drops nothing', async () => {
    const { service, blizzard } = build({ prefix: 'forever', blizzard: {} });
    blizzard.load.mockResolvedValue(new Map());
    expect((await resolve(service))?.level).toEqual(ROW.level);
  });
});

describe('WowFactsService — live seam freshness vs addon', () => {
  const addon58: WowFactCandidates = {
    level: { value: 58, source: 'addon', asOf: ago(10 * MIN) },
  };

  it('a fresh (1h) blizzard 60 beats a newer (10min) addon 58', async () => {
    const { service } = build({
      prefix: 'forever',
      blizzard: { level: { value: 60, source: 'blizzard', asOf: ago(HOUR) } },
      addon: addon58,
    });
    expect((await resolve(service))?.level?.value).toBe(60);
  });

  it('a stale (25h) blizzard value loses to the addon', async () => {
    const { service } = build({
      prefix: 'forever',
      blizzard: {
        level: { value: 60, source: 'blizzard', asOf: ago(25 * HOUR) },
      },
      addon: addon58,
    });
    expect((await resolve(service))?.level).toEqual(addon58.level);
  });
});

describe('dropShadowedBlizzard', () => {
  it('returns the row unchanged without blizzard candidates', () => {
    expect(dropShadowedBlizzard(ROW, undefined)).toBe(ROW);
  });

  it('drops only blizzard-labelled row facts the blizzard source answered', () => {
    const got = dropShadowedBlizzard(ROW, {
      level: { value: 60, source: 'blizzard', asOf: NOW },
      role: { value: 'dps', source: 'blizzard', asOf: NOW },
    });
    expect(got).toEqual({ class: ROW.class, role: ROW.role });
    expect(ROW).toHaveProperty('level');
  });
});
