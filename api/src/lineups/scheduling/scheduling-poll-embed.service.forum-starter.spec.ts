/**
 * ROK-2295 lane B — `syncEmbed` keeps the poll's forum-post starter live.
 * The render is mocked (its own path is covered by the lifecycle spec): this
 * spec pins WHEN the starter port runs and that it never blocks the card.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { POLL_FORUM_STARTER_PORT } from './poll-forum-starter.port';

const EMBED = { toJSON: () => ({ title: 'When should we play WoW?' }) };

jest.mock('./scheduling-poll-forum-card', () => ({
  SchedulingPollForumCard: jest.fn().mockImplementation(() => ({
    renderMatch: jest.fn().mockResolvedValue(EMBED),
  })),
  pollStarterCard: (embed: unknown) => ({ embeds: [embed], components: [] }),
}));

const MATCH_ID = 10;
const LINEUP_ID = 1;

function setup(port: { syncStarter: jest.Mock } | null) {
  const db: MockDb = createDrizzleMock();
  const editEmbed = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn((token: string) => {
    if (token !== POLL_FORUM_STARTER_PORT || !port) throw new Error('none');
    return port;
  });
  const service = new SchedulingPollEmbedService(
    db as never,
    {} as never,
    { editEmbed } as never,
    {} as never,
    {} as never,
    {} as never,
    { enqueue: jest.fn() } as never,
    { emitScheduleChanged: jest.fn() } as never,
    { get } as never,
  );
  return { db, service, editEmbed, get };
}

function queueMatch(db: MockDb, card: boolean): void {
  db.limit.mockResolvedValueOnce([
    {
      id: MATCH_ID,
      lineupId: LINEUP_ID,
      embedMessageId: card ? 'msg-1' : null,
      embedChannelId: card ? 'chan-1' : null,
    },
  ]);
}

describe('SchedulingPollEmbedService.syncEmbed — poll forum starter (ROK-2295)', () => {
  it('edits the forum starter for a poll with NO channel card', async () => {
    const port = { syncStarter: jest.fn().mockResolvedValue(undefined) };
    const { db, service, editEmbed } = setup(port);
    queueMatch(db, false);
    await service.syncEmbed(MATCH_ID);
    expect(port.syncStarter).toHaveBeenCalledWith(MATCH_ID, {
      embeds: [EMBED],
      components: [],
    });
    expect(editEmbed).not.toHaveBeenCalled();
  });

  it('edits the starter AND the channel card from the same render', async () => {
    const port = { syncStarter: jest.fn().mockResolvedValue(undefined) };
    const { db, service, editEmbed } = setup(port);
    queueMatch(db, true);
    await service.syncEmbed(MATCH_ID);
    expect(port.syncStarter).toHaveBeenCalledTimes(1);
    expect(editEmbed).toHaveBeenCalledWith('chan-1', 'msg-1', EMBED);
  });

  it('a starter failure never stops the channel card edit', async () => {
    const port = { syncStarter: jest.fn().mockRejectedValue(new Error('500')) };
    const { db, service, editEmbed } = setup(port);
    queueMatch(db, true);
    await expect(service.syncEmbed(MATCH_ID)).resolves.toBeUndefined();
    expect(editEmbed).toHaveBeenCalledWith('chan-1', 'msg-1', EMBED);
  });

  it('an unbound port (no forum module) still edits the channel card', async () => {
    const { db, service, editEmbed, get } = setup(null);
    queueMatch(db, true);
    await service.syncEmbed(MATCH_ID);
    expect(get).toHaveBeenCalledWith(POLL_FORUM_STARTER_PORT, {
      strict: false,
    });
    expect(editEmbed).toHaveBeenCalledTimes(1);
  });
});
