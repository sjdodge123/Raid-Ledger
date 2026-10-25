import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { NotificationService } from '../../notifications/notification.service';
import type { NotificationDedupService } from '../../notifications/notification-dedup.service';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import { StandalonePollReminderService } from './standalone-poll-reminder.service';
import { lineupHubPayload } from './poll-hub-payload.helpers';

jest.mock('./poll-hub-payload.helpers', () => ({
  lineupHubPayload: jest.fn(),
}));

const hubLookup = jest.mocked(lineupHubPayload);
const HOUR = 3_600_000;

/** One active poll 12h from its deadline (24h window) with two non-voters. */
function setup(dedupedUserIds: number[]) {
  const execute = jest
    .fn()
    .mockResolvedValueOnce([
      {
        lineupId: 4,
        matchId: 9,
        phaseDeadline: new Date(Date.now() + 12 * HOUR),
      },
    ])
    .mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
  const create = jest.fn().mockResolvedValue(null);
  const checkAndMarkSent = jest.fn((key: string) =>
    Promise.resolve(dedupedUserIds.some((id) => key.includes(`:${id}:`))),
  );
  const releaseKey = jest.fn().mockResolvedValue(undefined);
  const service = new StandalonePollReminderService(
    { execute } as unknown as PostgresJsDatabase<typeof schema>,
    { create } as unknown as NotificationService,
    { checkAndMarkSent, releaseKey } as unknown as NotificationDedupService,
    {} as CronJobService,
  );
  return { service, create, releaseKey };
}

describe('StandalonePollReminderService — hub lookup after dedupe', () => {
  beforeEach(() => {
    hubLookup.mockReset();
    hubLookup.mockResolvedValue({});
  });

  it('skips the hub lookup when every reminder is deduped', async () => {
    const { service, create } = setup([1, 2]);
    await service.runReminders();
    expect(hubLookup).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('looks the hub up once when at least one recipient remains', async () => {
    const { service, create } = setup([1]);
    await service.runReminders();
    expect(hubLookup).toHaveBeenCalledTimes(1);
    expect(hubLookup).toHaveBeenCalledWith(expect.anything(), 4);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 2 }));
  });

  it('resolves the hub once for several recipients', async () => {
    const { service, create } = setup([]);
    await service.runReminders();
    expect(hubLookup).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('gives the claim back when the hub lookup fails', async () => {
    hubLookup.mockRejectedValue(new Error('db down'));
    const { service, create, releaseKey } = setup([]);
    await service.runReminders();
    expect(releaseKey).toHaveBeenCalledWith('standalone-poll-reminder:9:1:24h');
    expect(create).not.toHaveBeenCalled();
  });
});
