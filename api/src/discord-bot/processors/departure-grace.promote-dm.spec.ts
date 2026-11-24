/**
 * ROK-2317: the creator's "promote from bench?" DM follows the creator's
 * Slot Vacated (`slot_vacated`) Discord switch.
 */
import { Logger } from '@nestjs/common';
import { sendCreatorPromoteDM } from './departure-grace.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { createMockEvent } from '../../common/testing/factories';
import { isDiscordDmMuted } from '../../notifications/discord-dm-mute.helpers';

jest.mock('../../notifications/discord-dm-mute.helpers', () => ({
  isDiscordDmMuted: jest.fn().mockResolvedValue(false),
}));

let db: MockDb;
const clientService = {
  isConnected: jest.fn().mockReturnValue(true),
  sendEmbedDM: jest.fn().mockResolvedValue(undefined),
};
const assignment = { id: 55, role: 'dps', position: 2 };

function deps() {
  return {
    db: db as never,
    clientService: clientService as never,
    logger: new Logger('test'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db = createDrizzleMock();
  db.limit
    .mockResolvedValueOnce([{ id: 88 }])
    .mockResolvedValueOnce([{ discordId: 'creator-discord-123' }]);
});

describe('sendCreatorPromoteDM (ROK-2317)', () => {
  it('sends the promote DM when Slot Vacated Discord is on', async () => {
    const event = createMockEvent({ id: 1, creatorId: 7 }) as never;
    await sendCreatorPromoteDM(deps(), event, 'Departed', assignment);
    expect(isDiscordDmMuted).toHaveBeenCalledWith(
      db,
      { userId: 7 },
      'slot_vacated',
    );
    expect(clientService.sendEmbedDM).toHaveBeenCalledTimes(1);
  });

  it('skips the promote DM when Slot Vacated Discord is off', async () => {
    jest.mocked(isDiscordDmMuted).mockResolvedValueOnce(true);
    const event = createMockEvent({ id: 1, creatorId: 7 }) as never;
    await sendCreatorPromoteDM(deps(), event, 'Departed', assignment);
    expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
  });
});
