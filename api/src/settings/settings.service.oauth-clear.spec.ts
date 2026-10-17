/**
 * ROK-1627 — clearing Discord OAuth tells listeners, exactly as setting it
 * does. The admin "clear" action used to delete the three keys directly and
 * emit nothing, so nothing that tracks the OAuth config ever heard about it.
 */
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from './settings.service';
import { SETTINGS_EVENTS } from './settings.types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('SettingsService.clearDiscordOAuthConfig', () => {
  const where = jest.fn().mockResolvedValue([]);
  const db = {
    select: jest
      .fn()
      .mockReturnValue({ from: jest.fn().mockResolvedValue([]) }),
    delete: jest.fn().mockReturnValue({ where }),
  };
  const emitter = { emit: jest.fn() };
  let service: SettingsService;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-oauth-clear';
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(SettingsService);
  });

  it('deletes the three OAuth keys', async () => {
    await service.clearDiscordOAuthConfig();
    expect(db.delete).toHaveBeenCalledTimes(3);
  });

  it('emits OAUTH_DISCORD_UPDATED with null, after the deletes', async () => {
    await service.clearDiscordOAuthConfig();
    expect(emitter.emit).toHaveBeenCalledWith(
      SETTINGS_EVENTS.OAUTH_DISCORD_UPDATED,
      null,
    );
    const lastDelete = Math.max(...where.mock.invocationCallOrder);
    const emitOrder = emitter.emit.mock.invocationCallOrder[0];
    expect(emitOrder).toBeGreaterThan(lastDelete);
  });
});
