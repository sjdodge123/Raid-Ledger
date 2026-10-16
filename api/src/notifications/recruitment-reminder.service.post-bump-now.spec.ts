/**
 * ROK-1812 — the DEMO `post-recruitment-bump` fixture seam reports what
 * actually happened, so a smoke fails on the real cause (not a poll timeout)
 * when an eligible event's bump was never posted.
 */
import { RecruitmentReminderService } from './recruitment-reminder.service';
import {
  makeEventRow,
  createRecruitmentReminderTestModule,
  type RecruitmentReminderTestMocks,
} from './recruitment-reminder.service.spec-helpers';

jest.mock(
  'discord.js',
  () =>
    jest.requireActual('../common/testing/discord-js-mock').discordJsFullMock,
);

describe('RecruitmentReminderService.postBumpNowForEvent (ROK-1812)', () => {
  let service: RecruitmentReminderService;
  let mocks: RecruitmentReminderTestMocks;

  beforeEach(async () => {
    ({ service, mocks } = await createRecruitmentReminderTestModule());
  });

  it('reports posted when the bump went out', async () => {
    const event = makeEventRow();
    mocks.mockDb.execute.mockResolvedValueOnce([event]);
    mocks.mockDiscordBotClient.isConnected.mockReturnValue(true);

    await expect(service.postBumpNowForEvent(event.id)).resolves.toBe('posted');
    expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
  });

  it('reports not-eligible when the event is not in the eligible set', async () => {
    mocks.mockDb.execute.mockResolvedValueOnce([]);

    await expect(service.postBumpNowForEvent(42)).resolves.toBe('not-eligible');
  });

  it('reports not-posted when the bot is offline', async () => {
    const event = makeEventRow();
    mocks.mockDb.execute.mockResolvedValueOnce([event]);
    mocks.mockDiscordBotClient.isConnected.mockReturnValue(false);

    await expect(service.postBumpNowForEvent(event.id)).resolves.toBe(
      'not-posted',
    );
  });

  it('reports not-posted when Discord rejects the post', async () => {
    const event = makeEventRow();
    mocks.mockDb.execute.mockResolvedValueOnce([event]);
    mocks.mockDiscordBotClient.isConnected.mockReturnValue(true);
    mocks.mockDiscordBotClient.sendEmbed.mockRejectedValue(
      new Error('Missing Access'),
    );

    await expect(service.postBumpNowForEvent(event.id)).resolves.toBe(
      'not-posted',
    );
  });
});
