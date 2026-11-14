import { Logger } from '@nestjs/common';
import {
  runWowBootSeed,
  seedWowReferenceData,
  WOW_BOOT_SEED_ENABLED,
} from './wow-boot-seed';
import { WowCommonModule } from './wow-common.module';

describe('runWowBootSeed (ROK-2196)', () => {
  it('runs the boot seed when enabled (prod default)', async () => {
    const seed = jest.fn((): Promise<void> => Promise.resolve());
    await expect(runWowBootSeed(true, seed)).resolves.toBe(true);
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('skips the boot seed when the integration harness disables it', async () => {
    const seed = jest.fn((): Promise<void> => Promise.resolve());
    await expect(runWowBootSeed(false, seed)).resolves.toBe(false);
    expect(seed).not.toHaveBeenCalled();
  });

  it('WowCommonModule enables the boot seed in prod via its DI token', () => {
    const providers: unknown = Reflect.getMetadata(
      'providers',
      WowCommonModule,
    );
    expect(providers).toEqual(
      expect.arrayContaining([
        { provide: WOW_BOOT_SEED_ENABLED, useValue: true },
      ]),
    );
  });
});

describe('seedWowReferenceData (ROK-2196)', () => {
  const logger = new Logger('wow-boot-seed.spec');
  const errorSpy = jest
    .spyOn(logger, 'error')
    .mockImplementation(() => undefined);

  it('seeds quests then bosses, and a failing quest seed does not stop bosses', async () => {
    const order: string[] = [];
    const quests = {
      seedQuests: jest.fn((): Promise<unknown> => {
        order.push('quests');
        return Promise.reject(new Error('relation "q" does not exist'));
      }),
    };
    const bosses = {
      seedBosses: jest.fn((): Promise<unknown> => {
        order.push('bosses');
        return Promise.resolve({});
      }),
    };
    await seedWowReferenceData(quests, bosses, logger);
    expect(order).toEqual(['quests', 'bosses']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
