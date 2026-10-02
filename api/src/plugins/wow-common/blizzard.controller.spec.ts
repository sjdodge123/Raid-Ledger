import {
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';
import { BlizzardController } from './blizzard.controller';
import type { BlizzardService } from './blizzard.service';

/**
 * TDB:1784: GET /blizzard/instances must keep the 502 the helpers map a
 * journal-expansion 403/5xx to, instead of re-wrapping it as a 500.
 */
describe('BlizzardController.getInstances — upstream errors', () => {
  function controllerRejectingWith(err: unknown) {
    const service = {
      fetchAllInstances: jest.fn().mockRejectedValue(err),
    } as unknown as BlizzardService;
    return new BlizzardController(service);
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
