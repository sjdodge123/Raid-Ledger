/**
 * Unit tests for autoSignupPollVoters (ROK-1379 follow-up).
 * When an event-plans scheduling poll materializes into an event, the winning
 * option's registered voters are auto-signed-up (mirrors ROK-1031 for lineups).
 */
import { autoSignupPollVoters } from './event-plans-auto-signup.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const EVENT_ID = 239;
const CREATOR_ID = 1;

describe('autoSignupPollVoters', () => {
  let mockDb: MockDb;
  let mockSignupsService: { signup: jest.Mock };

  const run = (voterDiscordIds: string[]) =>
    autoSignupPollVoters({
      db: mockDb as unknown as PostgresJsDatabase<typeof schema>,
      signupsService: mockSignupsService,
      eventId: EVENT_ID,
      creatorId: CREATOR_ID,
      voterDiscordIds,
    });

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockSignupsService = { signup: jest.fn().mockResolvedValue(undefined) };
  });

  it('signs up each resolved winning-option voter once', async () => {
    mockDb.where.mockResolvedValue([{ id: 106 }, { id: 109 }]);
    await run(['discord-106', 'discord-109']);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(2);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 106);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 109);
  });

  it('skips the plan creator (already signed up at plan close)', async () => {
    mockDb.where.mockResolvedValue([{ id: CREATOR_ID }, { id: 106 }]);
    await run(['discord-1', 'discord-106']);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 106);
  });

  it('dedupes resolved user ids', async () => {
    mockDb.where.mockResolvedValue([{ id: 106 }, { id: 106 }]);
    await run(['discord-106', 'discord-106b']);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
  });

  it('skips unresolved (unlinked) voters returned as null ids', async () => {
    mockDb.where.mockResolvedValue([{ id: 106 }, { id: null }]);
    await run(['discord-106', 'discord-unlinked']);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 106);
  });

  it('one rejected signup does not prevent the others', async () => {
    mockDb.where.mockResolvedValue([{ id: 106 }, { id: 109 }, { id: 110 }]);
    mockSignupsService.signup
      .mockRejectedValueOnce(new Error('event not accepting signups'))
      .mockResolvedValue(undefined);
    await expect(
      run(['discord-106', 'discord-109', 'discord-110']),
    ).resolves.toBeUndefined();
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(3);
  });

  it('performs no db query for an empty voter list', async () => {
    await run([]);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockSignupsService.signup).not.toHaveBeenCalled();
  });

  it('never throws when voter resolution fails (plan already completed)', async () => {
    mockDb.where.mockRejectedValue(new Error('db down'));
    await expect(run(['discord-106'])).resolves.toBeUndefined();
    expect(mockSignupsService.signup).not.toHaveBeenCalled();
  });
});
