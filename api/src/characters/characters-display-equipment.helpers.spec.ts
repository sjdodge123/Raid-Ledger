import type { CharacterDto } from '@raid-ledger/contract';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import { withDisplayEquipment } from './characters-display-equipment.helpers';

const stored = {
  id: 'char-1',
  gameVariant: 'classic_anniversary',
  equipment: { items: [], syncedAt: '2026-10-09T00:00:00.000Z' },
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
