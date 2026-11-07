import {
  BadGatewayException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BlizzardController } from './blizzard.controller';
import type { BlizzardService } from './blizzard.service';
import type { ForeverConfigService } from './forever-config.service';

function foreverConfig(enabled: boolean): ForeverConfigService {
  return {
    isArmoryImportEnabled: jest.fn().mockResolvedValue(enabled),
  } as unknown as ForeverConfigService;
}

/**
 * TDB:1784: GET /blizzard/instances must keep the 502 the helpers map a
 * journal-expansion 403/5xx to, instead of re-wrapping it as a 500.
 */
describe('BlizzardController.getInstances — upstream errors', () => {
  function controllerRejectingWith(err: unknown) {
    const service = {
      fetchAllInstances: jest.fn().mockRejectedValue(err),
    } as unknown as BlizzardService;
    return new BlizzardController(service, foreverConfig(true));
  }

  it('passes a mapped 502 through with its status and message', async () => {
    const upstream = new BadGatewayException(
      "Blizzard's API doesn't serve instances for this game version yet (403).",
    );
    const controller = controllerRejectingWith(upstream);

    const call = controller.getInstances('classic_era', 'raid', 'us');

    await expect(call).rejects.toBe(upstream);
  });

  it('still wraps an unexpected error as a 500', async () => {
    const controller = controllerRejectingWith(new Error('socket hang up'));

    const call = controller.getInstances('retail', 'dungeon', 'us');

    await expect(call).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(call).rejects.toHaveProperty(
      'message',
      'Failed to fetch instances: socket hang up',
    );
  });
});

describe('BlizzardController.getCharacterPreview — Forever kill switch (ROK-1722)', () => {
  function controller(enabled: boolean) {
    const service = {
      fetchCharacterProfile: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValue({ name: 'Ana Forever' }),
    };
    return {
      service,
      ctl: new BlizzardController(
        service as unknown as BlizzardService,
        foreverConfig(enabled),
      ),
    };
  }

  it('403s a Forever preview while the switch is off, without calling Blizzard', async () => {
    const { service, ctl } = controller(false);
    const call = ctl.getCharacterPreview(
      'Ana Forever',
      undefined,
      'us',
      'wow_forever',
    );
    await expect(call).rejects.toThrow(
      new ForbiddenException('Armory import for WoW: Forever is turned off'),
    );
    expect(service.fetchCharacterProfile).not.toHaveBeenCalled();
  });

  it('previews a Forever character realmless (supplied realm ignored) when on', async () => {
    const { service, ctl } = controller(true);
    await ctl.getCharacterPreview(
      'Ana Forever',
      'Someplace',
      'us',
      'wow_forever',
    );
    expect(service.fetchCharacterProfile.mock.calls[0]?.slice(0, 3)).toEqual([
      'Ana Forever',
      null,
      'us',
    ]);
  });

  it('never consults the switch for retail', async () => {
    const cfg = foreverConfig(false);
    const service = { fetchCharacterProfile: jest.fn().mockResolvedValue({}) };
    const ctl = new BlizzardController(
      service as unknown as BlizzardService,
      cfg,
    );
    await ctl.getCharacterPreview('Thrall', 'Area 52', 'us', 'retail');
    expect(cfg.isArmoryImportEnabled).not.toHaveBeenCalled();
  });
});
