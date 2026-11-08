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
  (await service.resolveFacts([REF])).facts.get('m1');

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

  // Since ROK-2102 step 2 (#1979) a null/alias prefix resolves to `forever`,
  // so the default prefix never turns the seam off: the switch alone decides.
  it.each<[string, string | null, string | null, boolean]>([
    ['null (default)', null, null, true],
    ['the stored alias', FOREVER_NAMESPACE_ALIAS, null, true],
    ['null (default)', null, 'false', false],
    ['the stored alias', FOREVER_NAMESPACE_ALIAS, 'false', false],
  ])(
    'prefix %s resolves to forever; switch %p → consulted: %p',
    async (_l, prefix, switchValue, consulted) => {
      const { service, blizzard } = build({
        prefix,
        switchValue,
        blizzard: level60,
      });
      const ids = (await service.activeSources()).map((s) => s.id);
      expect(ids.includes('blizzard')).toBe(consulted);
      await service.resolveFacts([REF]);
      expect(blizzard.load).toHaveBeenCalledTimes(consulted ? 1 : 0);
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

describe('WowFactsService — live seam: Blizzard wins regardless of age (ROK-2138)', () => {
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

  it('a 25h-old blizzard value still beats the newer addon', async () => {
    const { service } = build({
      prefix: 'forever',
      blizzard: {
        level: { value: 60, source: 'blizzard', asOf: ago(25 * HOUR) },
      },
      addon: addon58,
    });
    expect((await resolve(service))?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: ago(25 * HOUR),
    });
  });

  it("AC6: a 10-day-old Armory row beats today's snapshot on level/class/ilvl/gear/role; lockouts stay the addon's", async () => {
    const old = ago(240 * HOUR);
    const gear = [{ slot: 1, itemId: 12640, ilvl: 63, bonusIds: [] }];
    const { service } = build({
      prefix: 'forever',
      blizzard: {
        level: { value: 60, source: 'blizzard', asOf: old },
        class: { value: 'Warrior', source: 'blizzard', asOf: old },
        ilvl: { value: 63, source: 'blizzard', asOf: old },
        gear: { value: gear, source: 'blizzard', asOf: old },
        role: { value: 'tank', source: 'blizzard', asOf: old },
      },
      addon: {
        level: { value: 58, source: 'addon', asOf: NOW },
        class: { value: 'Mage', source: 'addon', asOf: NOW },
        ilvl: { value: 70, source: 'addon', asOf: NOW },
        gear: { value: [], source: 'addon', asOf: NOW },
        lockouts: { value: [], source: 'addon', asOf: NOW },
      },
    });
    const got = await resolve(service);
    for (const f of ['level', 'class', 'ilvl', 'gear'] as const) {
      expect(got?.[f]?.source).toBe('blizzard');
    }
    expect(got?.level?.value).toBe(60);
    expect(got?.gear?.value).toEqual(gear);
    // The row's manual roleOverride still beats the Blizzard role (AC4).
    expect(got?.role).toEqual(ROW.role);
    expect(got?.lockouts?.source).toBe('addon');
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

  // ROK-2107 review r2 MINOR 2: the shadowing contract for professions.
  it("drops the row's blizzard professions copy the source answered; keeps a manual one", () => {
    const bz = {
      value: { primary: [], secondary: [], syncedAt: NOW.toISOString() },
      source: 'blizzard' as const,
      asOf: NOW,
    };
    const answered = { professions: bz };
    expect(dropShadowedBlizzard({ ...ROW, professions: bz }, answered)).toEqual(
      {
        class: ROW.class,
        role: ROW.role,
        level: ROW.level,
      },
    );
    const manual = {
      value: { primary: [], secondary: [], syncedAt: NOW.toISOString() },
      source: 'manual' as const,
      asOf: null,
    };
    expect(
      dropShadowedBlizzard({ ...ROW, professions: manual }, answered),
    ).toHaveProperty('professions', manual);
  });
});
