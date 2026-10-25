/**
 * ROK-1956 L2 — handler registry routing (U-1..U-5, AC "unit tests for
 * registry routing"). Handlers are registered in this spec only (D-4).
 */
import {
  COMPANION_CONTRACTS,
  type CompanionContractTable,
  type CompanionContractVersionSpec,
} from '@raid-ledger/contract';
import { z } from 'zod';
import {
  COMPANION_DEFAULT_MIN_INTERVAL_SEC,
  CompanionHandlerRegistry,
  type CompanionContractHandler,
} from './companion-handler.registry';

const OWNER = 'bg3';

function spec(
  status: CompanionContractVersionSpec['status'],
): CompanionContractVersionSpec {
  return { schema: z.unknown(), maxBytes: 1024, blobSlots: [], status };
}

const TABLE: CompanionContractTable = {
  ...COMPANION_CONTRACTS,
  'test-retired': { 1: spec('retired'), 2: spec('current') },
};

function handler(
  extra: Partial<CompanionContractHandler> = {},
): CompanionContractHandler {
  return {
    contract: 'bg3-save',
    versions: [1],
    handle: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

function setup(active: Set<string> = new Set([OWNER])) {
  const plugins = { isActive: jest.fn((slug: string) => active.has(slug)) };
  const registry = new CompanionHandlerRegistry(plugins, TABLE);
  return { registry, active, plugins };
}

describe('CompanionHandlerRegistry (ROK-1956 §5)', () => {
  it('U-1 resolves a handler owned by an active plugin', () => {
    const { registry } = setup();
    const h = handler();
    registry.register(OWNER, h);
    expect(registry.resolve('bg3-save', 1, 'device')).toBe(h);
    expect(registry.resolve('bg3-save', 2, 'device')).toBeNull();
    expect(registry.resolve('other', 1, 'device')).toBeNull();
  });

  it('U-2 owner inactive → null; reactivated → returned without re-registering', () => {
    const { registry, active } = setup();
    const h = handler();
    registry.register(OWNER, h);
    active.delete(OWNER);
    expect(registry.resolve('bg3-save', 1, 'device')).toBeNull();
    active.add(OWNER);
    expect(registry.resolve('bg3-save', 1, 'device')).toBe(h);
  });

  it.each<[string, string, Partial<CompanionContractHandler>]>([
    ['an empty owner', '  ', {}],
    ['an unknown contract id', OWNER, { contract: 'nope' }],
    ['a prototype key as contract id', OWNER, { contract: '__proto__' }],
    ['an unlisted version', OWNER, { versions: [2] }],
    ['a retired version', OWNER, { contract: 'test-retired', versions: [1] }],
    ['empty versions', OWNER, { versions: [] }],
    ['a repeated version', OWNER, { versions: [1, 1] }],
    ['empty sources', OWNER, { sources: [] }],
    ['a non-positive cadence', OWNER, { cadence: { minIntervalSec: 0 } }],
  ])('U-3 register throws on %s', (_name, owner, extra) => {
    const { registry } = setup();
    expect(() => registry.register(owner, handler(extra))).toThrow(Error);
    expect(registry.list()).toEqual([]);
  });

  it('U-3 register throws on a duplicate (contract, version) across owners', () => {
    const { registry } = setup(new Set([OWNER, 'other']));
    registry.register(OWNER, handler());
    expect(() => registry.register('other', handler())).toThrow(
      /bg3-save v1 is already registered/,
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('U-4 device-only by default; a session opt-in is per handler', () => {
    const { registry } = setup();
    registry.register(OWNER, handler());
    expect(registry.resolve('bg3-save', 1, 'session')).toBeNull();
    const both = handler({
      contract: 'test-retired',
      versions: [2],
      sources: ['device', 'session'],
    });
    registry.register(OWNER, both);
    expect(registry.resolve('test-retired', 2, 'session')).toBe(both);
    const sessionOnly = setup().registry;
    sessionOnly.register(OWNER, handler({ sources: ['session'] }));
    expect(sessionOnly.resolve('bg3-save', 1, 'device')).toBeNull();
  });

  it('U-5 list reports owner, versions, sources, cadence (default 120) and activity', () => {
    const { registry, active } = setup(new Set([OWNER, 'other']));
    registry.register(OWNER, handler());
    registry.register(
      'other',
      handler({
        contract: 'test-retired',
        versions: [2],
        cadence: { minIntervalSec: 30 },
      }),
    );
    active.delete('other');
    expect(COMPANION_DEFAULT_MIN_INTERVAL_SEC).toBe(120);
    expect(registry.list()).toEqual([
      {
        ownerPluginId: OWNER,
        contract: 'bg3-save',
        versions: [1],
        sources: ['device'],
        cadence: { minIntervalSec: 120 },
        active: true,
      },
      {
        ownerPluginId: 'other',
        contract: 'test-retired',
        versions: [2],
        sources: ['device'],
        cadence: { minIntervalSec: 30 },
        active: false,
      },
    ]);
  });

  it('defaults to the shipped contract table', () => {
    const registry = new CompanionHandlerRegistry({ isActive: () => true });
    expect(() =>
      registry.register(
        OWNER,
        handler({ contract: 'test-retired', versions: [2] }),
      ),
    ).toThrow(Error);
    registry.register(OWNER, handler());
    expect(registry.resolve('bg3-save', 1, 'device')).not.toBeNull();
  });
});
