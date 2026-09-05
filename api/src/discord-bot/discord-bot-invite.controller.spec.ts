import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotInviteController } from './discord-bot-invite.controller';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  REQUIRED_PERMISSIONS,
  botInvitePermissionsBits,
} from './discord-bot-client.helpers';

describe('DiscordBotInviteController (ROK-1471 AC11)', () => {
  const getClientId = jest.fn<string | null, []>();

  const build = async (): Promise<DiscordBotInviteController> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiscordBotInviteController],
      providers: [{ provide: DiscordBotClientService, useValue: { getClientId } }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(DiscordBotInviteController);
  };

  beforeEach(() => jest.resetAllMocks());

  it('returns a derived url carrying the derived permission bits', async () => {
    getClientId.mockReturnValue('4242');
    const controller = await build();

    const result = controller.getInviteUrl();

    expect(result.clientId).toBe('4242');
    expect(result.url).toContain('client_id=4242');
    expect(result.url).toContain(
      `permissions=${botInvitePermissionsBits().toString()}`,
    );
    expect(result.url).toContain('scope=bot%20applications.commands');
  });

  it('lists every required permission label, thread trio included', async () => {
    getClientId.mockReturnValue('1');
    const controller = await build();

    const { permissions } = controller.getInviteUrl();

    expect(permissions).toEqual(REQUIRED_PERMISSIONS.map((p) => p.label));
    expect(permissions).toContain('Send Messages in Threads');
  });

  it('returns a null url but still lists permissions with no client id', async () => {
    getClientId.mockReturnValue(null);
    const controller = await build();

    const result = controller.getInviteUrl();

    expect(result.url).toBeNull();
    expect(result.clientId).toBeNull();
    expect(result.permissions.length).toBe(REQUIRED_PERMISSIONS.length);
  });
});
