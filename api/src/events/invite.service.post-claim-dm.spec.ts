/**
 * ROK-2317: the post-claim "You have joined" DM follows the Event invites
 * (`new_event`) Discord switch.
 */
import { Test } from '@nestjs/testing';
import { InviteService } from './invite.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SignupsService } from './signups.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { isDiscordDmMuted } from '../notifications/discord-dm-mute.helpers';

jest.mock('../notifications/discord-dm-mute.helpers', () => ({
  isDiscordDmMuted: jest.fn().mockResolvedValue(false),
}));

let service: InviteService;
let db: MockDb;
const discord = {
  isConnected: jest.fn().mockReturnValue(true),
  sendDirectMessage: jest.fn().mockResolvedValue(undefined),
};

beforeEach(async () => {
  jest.clearAllMocks();
  db = createDrizzleMock();
  db.limit.mockResolvedValue([{ discordId: 'discord-user-1' }]);
  const module = await Test.createTestingModule({
    providers: [
      InviteService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: SignupsService, useValue: { signup: jest.fn() } },
      {
        provide: SettingsService,
        useValue: {
          getTrustedClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
        },
      },
      { provide: DiscordBotClientService, useValue: discord },
    ],
  }).compile();
  service = module.get(InviteService);
});

describe('InviteService — post-claim DM (ROK-2317)', () => {
  it('sends the "You have joined" DM when Event invites Discord is on', async () => {
    await service['sendPostClaimDM'](5, 'Raid Night', 42);
    expect(isDiscordDmMuted).toHaveBeenCalledWith(
      db,
      { userId: 5 },
      'new_event',
    );
    expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
  });

  it('skips the DM when Event invites Discord is off', async () => {
    jest.mocked(isDiscordDmMuted).mockResolvedValueOnce(true);
    await service['sendPostClaimDM'](5, 'Raid Night', 42);
    expect(discord.sendDirectMessage).not.toHaveBeenCalled();
  });
});
