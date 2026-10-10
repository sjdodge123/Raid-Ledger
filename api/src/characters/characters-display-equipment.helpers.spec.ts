import type { CharacterDto } from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import {
  withDisplayEquipment,
  withDisplayOverrides,
  withDisplayTalents,
} from './characters-display-equipment.helpers';

const stored = {
  id: 'char-1',
  gameVariant: 'classic_anniversary',
  equipment: { items: [], syncedAt: '2026-10-09T00:00:00.000Z' },
  talents: null,
  lastSyncedAt: '2026-10-01T00:00:00.000Z',
} as unknown as CharacterDto;

const adapterWith = (
  resolveDisplayEquipment: jest.Mock,
): CharacterSyncAdapter =>
  ({ resolveDisplayEquipment }) as unknown as CharacterSyncAdapter;

describe('withDisplayEquipment (ROK-1727)', () => {
  const logger = { warn: jest.fn() };
  beforeEach(() => logger.warn.mockReset());

  it('substitutes the equipment the hook returns', async () => {
    const equipment = { items: [{ slot: 'HEAD' }] };
    const hook = jest.fn().mockResolvedValue(equipment);
    const out = await withDisplayEquipment(stored, adapterWith(hook), logger);
    expect(out.equipment).toBe(equipment);
    expect(hook).toHaveBeenCalledWith({
      id: 'char-1',
      gameVariant: 'classic_anniversary',
      equipment: stored.equipment,
    });
  });

  it('keeps the stored DTO when there is no adapter or the hook returns undefined', async () => {
    expect(await withDisplayEquipment(stored, undefined, logger)).toBe(stored);
    const hook = jest.fn().mockResolvedValue(undefined);
    expect(await withDisplayEquipment(stored, adapterWith(hook), logger)).toBe(
      stored,
    );
  });

  it('a failing hook logs a warning and returns the stored DTO instead of throwing', async () => {
    const hook = jest.fn().mockRejectedValue(new Error('snapshot query down'));
    await expect(
      withDisplayEquipment(stored, adapterWith(hook), logger),
    ).resolves.toBe(stored);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('snapshot query down'),
    );
  });
});

describe('withDisplayTalents / withDisplayOverrides (ROK-1744)', () => {
  const logger = { warn: jest.fn() };
  beforeEach(() => logger.warn.mockReset());
  const talents = { format: 'forever', nodes: [{ nodeId: 1, rank: 1 }] };
  const hooks = (
    resolveDisplayEquipment: jest.Mock,
    resolveDisplayTalents: jest.Mock,
  ): CharacterSyncAdapter =>
    ({
      resolveDisplayEquipment,
      resolveDisplayTalents,
    }) as unknown as CharacterSyncAdapter;

  it('substitutes the talents the hook returns, passing the row fields', async () => {
    const hook = jest.fn().mockResolvedValue(talents);
    const adapter = hooks(jest.fn(), hook);
    const out = await withDisplayTalents(stored, adapter, logger);
    expect(out.talents).toBe(talents);
    expect(hook).toHaveBeenCalledWith({
      id: 'char-1',
      gameVariant: 'classic_anniversary',
      talents: null,
      lastSyncedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('keeps the stored DTO when the hook returns undefined or is absent', async () => {
    expect(await withDisplayTalents(stored, undefined, logger)).toBe(stored);
    const adapter = hooks(jest.fn(), jest.fn().mockResolvedValue(undefined));
    expect(await withDisplayTalents(stored, adapter, logger)).toBe(stored);
  });

  it('a throwing talents hook leaves the row unchanged and warns', async () => {
    const hook = jest.fn().mockRejectedValue(new Error('talents query down'));
    await expect(
      withDisplayTalents(stored, hooks(jest.fn(), hook), logger),
    ).resolves.toBe(stored);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('talents query down'),
    );
  });

  it('applies equipment then talents; a talents failure keeps the gear', async () => {
    const equipment = { items: [{ slot: 'HEAD' }] };
    const eq = jest.fn().mockResolvedValue(equipment);
    const tal = jest.fn().mockResolvedValue(talents);
    const both = await withDisplayOverrides(stored, hooks(eq, tal), logger);
    expect(both).toMatchObject({ equipment, talents });
    expect(eq.mock.invocationCallOrder[0]).toBeLessThan(
      tal.mock.invocationCallOrder[0]!,
    );
    const failing = hooks(eq, jest.fn().mockRejectedValue(new Error('boom')));
    const gearOnly = await withDisplayOverrides(stored, failing, logger);
    expect(gearOnly.equipment).toBe(equipment);
    expect(gearOnly.talents).toBeNull();
  });
});
