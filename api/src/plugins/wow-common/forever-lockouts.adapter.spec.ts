/**
 * Unit specs for the pure Forever lockouts adapter (ROK-1743 L1).
 */
import type { AddonLockout } from '@raid-ledger/contract';
import type { ForeverCharSnapshot } from './forever-char-snapshot.query';
import {
  DIFFICULTY_LABELS,
  difficultyLabel,
  snapshotToLockouts,
} from './forever-lockouts.adapter';

const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1000;
const CAPTURED_AT = new Date('2026-10-09T21:00:00.000Z');

function lockout(overrides: Partial<AddonLockout> = {}): AddonLockout {
  return {
    name: 'Molten Core',
    instanceId: 409,
    difficultyId: 9,
    resetAt: NOW_S + 3600,
    killed: 3,
    total: 10,
    ...overrides,
  };
}

function snapshot(lockouts: AddonLockout[]): ForeverCharSnapshot {
  return {
    data: { gear: [], talents: { nodes: [] }, lockouts },
    capturedAt: CAPTURED_AT,
  };
}

describe('difficultyLabel', () => {
  it('maps the known 40-player id', () => {
    expect(difficultyLabel(9)).toBe('40 Player');
    expect(DIFFICULTY_LABELS[148]).toBe('20 Player');
  });

  it('returns null for an unmapped id', () => {
    expect(difficultyLabel(9999)).toBeNull();
  });
});

describe('snapshotToLockouts', () => {
  it('maps fields and converts unix seconds to ISO', () => {
    const out = snapshotToLockouts(snapshot([lockout()]), NOW_MS);
    expect(out).toEqual({
      source: 'addon',
      syncedAt: CAPTURED_AT.toISOString(),
      instances: [
        {
          name: 'Molten Core',
          instanceId: 409,
          difficultyId: 9,
          difficulty: '40 Player',
          resetAt: new Date((NOW_S + 3600) * 1000).toISOString(),
          killed: 3,
          total: 10,
        },
      ],
    });
  });

  it('gives an unmapped difficulty a null label', () => {
    const out = snapshotToLockouts(
      snapshot([lockout({ difficultyId: 9999 })]),
      NOW_MS,
    );
    expect(out?.instances[0]?.difficulty).toBeNull();
  });

  it('drops lockouts whose reset is at or before now', () => {
    const out = snapshotToLockouts(
      snapshot([
        lockout({ name: 'Past', resetAt: NOW_S - 1 }),
        lockout({ name: 'Exactly now', resetAt: NOW_S }),
        lockout({ name: 'Future' }),
      ]),
      NOW_MS,
    );
    expect(out?.instances.map((i) => i.name)).toEqual(['Future']);
  });

  it('returns undefined when every lockout has expired', () => {
    const out = snapshotToLockouts(
      snapshot([lockout({ resetAt: NOW_S - 60 })]),
      NOW_MS,
    );
    expect(out).toBeUndefined();
  });

  it('returns undefined for an empty lockouts array', () => {
    expect(snapshotToLockouts(snapshot([]), NOW_MS)).toBeUndefined();
  });

  it('sorts soonest reset first, then by name', () => {
    const out = snapshotToLockouts(
      snapshot([
        lockout({ name: 'Zul', resetAt: NOW_S + 7200 }),
        lockout({ name: 'Onyxia', resetAt: NOW_S + 3600 }),
        lockout({ name: 'BWL', resetAt: NOW_S + 7200 }),
      ]),
      NOW_MS,
    );
    expect(out?.instances.map((i) => i.name)).toEqual(['Onyxia', 'BWL', 'Zul']);
  });
});
