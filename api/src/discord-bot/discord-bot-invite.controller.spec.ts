import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';
import { DiscordBotInviteController } from './discord-bot-invite.controller';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  REQUIRED_PERMISSIONS,
  botInvitePermissionsBits,
} from './discord-bot-client.helpers';

const getClientId = jest.fn<string | null, []>();
const getSetting = jest.fn<Promise<string | null>, [string]>();

const build = async (): Promise<DiscordBotInviteController> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [DiscordBotInviteController],
    providers: [
      { provide: DiscordBotClientService, useValue: { getClientId } },
      { provide: SettingsService, useValue: { get: getSetting } },
    ],
  })
    .overrideGuard(AuthGuard('jwt'))
    .useValue({ canActivate: () => true })
    .overrideGuard(AdminGuard)
    .useValue({ canActivate: () => true })
    .compile();
  return moduleRef.get(DiscordBotInviteController);
};

const expectInviteUrlFor = (url: string | null, id: string): void => {
  expect(url).toContain(`client_id=${id}`);
  expect(url).toContain(`permissions=${botInvitePermissionsBits().toString()}`);
  expect(url).toContain('scope=bot%20applications.commands');
};

describe('DiscordBotInviteController (ROK-1471 AC11)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    getSetting.mockResolvedValue(null);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => warnSpy.mockRestore());

  it('returns a derived url carrying the derived permission bits', async () => {
    getClientId.mockReturnValue('4242');
    const controller = await build();

    const result = await controller.getInviteUrl();

    expect(result.clientId).toBe('4242');
    expectInviteUrlFor(result.url, '4242');
  });

  it('lists every required permission label, thread trio included', async () => {
    getClientId.mockReturnValue('1');
    const controller = await build();

    const { permissions } = await controller.getInviteUrl();

    expect(permissions).toEqual(REQUIRED_PERMISSIONS.map((p) => p.label));
    expect(permissions).toContain('Send Messages in Threads');
  });

  it('returns a null url but still lists permissions with no client id', async () => {
    getClientId.mockReturnValue(null);
    const controller = await build();

    const result = await controller.getInviteUrl();

    expect(result.url).toBeNull();
    expect(result.clientId).toBeNull();
    expect(result.permissions.length).toBe(REQUIRED_PERMISSIONS.length);
  });
});

describe('DiscordBotInviteController saved client id fallback (ROK-1702)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    getSetting.mockResolvedValue(null);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => warnSpy.mockRestore());

  it('falls back to the saved OAuth client id when the bot is not ready (AC1)', async () => {
    getClientId.mockReturnValue(null);
    getSetting.mockResolvedValue('7777');
    const controller = await build();

    const result = await controller.getInviteUrl();

    expect(getSetting).toHaveBeenCalledWith(SETTING_KEYS.DISCORD_CLIENT_ID);
    expect(result.clientId).toBe('7777');
    expectInviteUrlFor(result.url, '7777');
  });

  it('treats a blank saved client id as absent (D4)', async () => {
    getClientId.mockReturnValue(null);
    getSetting.mockResolvedValue('   ');
    const controller = await build();

    const result = await controller.getInviteUrl();

    expect(result.url).toBeNull();
    expect(result.clientId).toBeNull();
  });

  it('prefers the ready id over a differing saved id and warns once (AC3)', async () => {
    getClientId.mockReturnValue('4242');
    getSetting.mockResolvedValue('7777');
    const controller = await build();

    const first = await controller.getInviteUrl();
    await controller.getInviteUrl();

    expect(first.clientId).toBe('4242');
    expectInviteUrlFor(first.url, '4242');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toEqual(
      expect.stringContaining('OAuth client id and bot application differ'),
    );
  });

  it('does not warn when the ready and saved ids match', async () => {
    getClientId.mockReturnValue('4242');
    getSetting.mockResolvedValue('4242');
    const controller = await build();

    const result = await controller.getInviteUrl();

    expect(result.clientId).toBe('4242');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
