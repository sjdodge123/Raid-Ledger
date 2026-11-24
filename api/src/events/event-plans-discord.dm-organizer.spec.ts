/**
 * ROK-2317: every event-plan organizer DM follows the Scheduling polls
 * (`scheduling_poll`) Discord switch.
 */
import { dmOrganizer } from './event-plans-discord.helpers';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { isDiscordDmMuted } from '../notifications/discord-dm-mute.helpers';

jest.mock('../notifications/discord-dm-mute.helpers', () => ({
  isDiscordDmMuted: jest.fn().mockResolvedValue(false),
}));

let db: MockDb;
const discord = { sendDirectMessage: jest.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  jest.clearAllMocks();
  db = createDrizzleMock();
  db.limit.mockResolvedValue([{ discordId: 'organizer-discord' }]);
});

describe('dmOrganizer (ROK-2317)', () => {
  it('DMs the organizer when Scheduling polls Discord is on', async () => {
    await dmOrganizer(db as never, discord as never, 42, 'hello');
    expect(isDiscordDmMuted).toHaveBeenCalledWith(
      db,
      { userId: 42 },
      'scheduling_poll',
    );
    expect(discord.sendDirectMessage).toHaveBeenCalledWith(
      'organizer-discord',
      'hello',
    );
  });

  it('sends nothing when Scheduling polls Discord is off', async () => {
    jest.mocked(isDiscordDmMuted).mockResolvedValueOnce(true);
    await dmOrganizer(db as never, discord as never, 42, 'hello');
    expect(discord.sendDirectMessage).not.toHaveBeenCalled();
  });
});
