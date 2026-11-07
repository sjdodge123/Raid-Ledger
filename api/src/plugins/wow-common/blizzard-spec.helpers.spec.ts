/**
 * ROK-2110: Classic tree extraction picks the active group (D9), and the
 * Forever specializations response is logged keys-only, once (D8).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  describeSpecKeys,
  logForeverSpecKeysOnce,
  resetForeverSpecKeysLogForTests,
} from './blizzard-spec-keys.log';
import {
  extractClassicTrees,
  fetchCharacterSpecializations,
} from './blizzard-spec.helpers';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';

function fixtureSpecData(): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(
      join(__dirname, 'testing/fixtures/blizzard-forever/specializations.json'),
      'utf8',
    ),
  );
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('specializations fixture is not an object');
  }
  return { ...raw };
}

describe('extractClassicTrees is_active (ROK-2110 D9)', () => {
  it('prefers the is_active group over group 0', () => {
    const names = extractClassicTrees(fixtureSpecData()).map(
      (t) => t.specialization_name,
    );
    expect(names).toEqual(['Arms', 'Fury']);
  });

  it('falls back to group 0 when no group is active', () => {
    const data = {
      specialization_groups: [
        { specializations: [{ specialization_name: 'Holy' }] },
        { specializations: [{ specialization_name: 'Shadow' }] },
      ],
    };
    expect(extractClassicTrees(data)).toEqual([
      { specialization_name: 'Holy' },
    ]);
  });

  it('a top-level specializations array still wins (unchanged path)', () => {
    const data = {
      specializations: [{ specialization_name: 'Top' }],
      specialization_groups: [
        { is_active: true, specializations: [{ specialization_name: 'G' }] },
      ],
    };
    expect(extractClassicTrees(data)).toEqual([{ specialization_name: 'Top' }]);
  });
});

describe('Forever specializations keys-only log (ROK-2110 D8)', () => {
  const fetchMock = jest.fn();
  const logger = { debug: jest.fn(), log: jest.fn() };

  beforeEach(() => {
    resetForeverSpecKeysLogForTests();
    fetchMock.mockReset();
    logger.log.mockReset();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixtureSpecData()),
    });
  });

  const fetchSpec = (prefix: string | null) =>
    fetchCharacterSpecializations(
      'Ana Forever',
      prefix === FOREVER_NAMESPACE_ALIAS ? null : 'some-realm',
      'us',
      'Warrior',
      prefix,
      'tok',
      logger,
    );

  it('logs the key paths once per process, with no values', async () => {
    await fetchSpec(FOREVER_NAMESPACE_ALIAS);
    await fetchSpec(FOREVER_NAMESPACE_ALIAS);
    expect(logger.log).toHaveBeenCalledTimes(1);
    const line = String(logger.log.mock.calls[0]?.[0]);
    expect(line).toContain(
      'talents[0]=[column_index,spell_tooltip,talent,talent_rank,tier_index]',
    );
    expect(line).toContain('talents[0].talent=[id,name]');
    for (const value of [
      'Shield Specialization',
      'Improved Heroic Strike',
      'Arms',
      '1601',
      '12298',
      'Ana',
    ]) {
      expect(line).not.toContain(value);
    }
  });

  it('does not log for a non-Forever prefix', async () => {
    await fetchSpec('classic1x');
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('describeSpecKeys tolerates an empty response', () => {
    expect(describeSpecKeys({})).toBe(
      'top=[] groups=- group[0]=- specializations[0]=- talents[0]=- talents[0].talent=- talents[0].spell_tooltip=-',
    );
    const once = { log: jest.fn() };
    logForeverSpecKeysOnce({}, once);
    logForeverSpecKeysOnce({}, once);
    expect(once.log).toHaveBeenCalledTimes(1);
  });
});
