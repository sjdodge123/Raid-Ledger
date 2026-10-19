/**
 * ROK-1832 (Codex r3): an already-tagged event rescheduled INTO its lead-time
 * window gets its first embed from the update path, which must announce the
 * group too — loaded from the event row, group-only, untagged → nothing.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { announceGroupForEvent } from './embed-scheduler-announce.helpers';

const start = new Date('2026-11-01T20:00:00Z');
const end = new Date('2026-11-01T23:00:00Z');

function eventRow(guildId: number | null): Record<string, unknown> {
  return {
    id: 42,
    title: 'Raid',
    duration: [start, end],
    gameId: 5,
    guildId,
    creatorId: 9,
  };
}

function deps(rows: unknown[][]): {
  notify: jest.Mock;
  run: () => Promise<void>;
} {
  const db = createDrizzleMock();
  for (const r of rows) db.limit.mockResolvedValueOnce(r);
  const notify = jest.fn().mockResolvedValue(undefined);
  const run = (): Promise<void> =>
    announceGroupForEvent(
      {
        db,
        affinity: { notifyGameAffinity: notify },
        clientUrl: () => Promise.resolve('https://x'),
      },
      42,
    );
  return { notify, run };
}

describe('announceGroupForEvent', () => {
  it('sends one group-only announce for a group-tagged event', async () => {
    const d = deps([
      [eventRow(3)],
      [{ guildId: 'g', channelId: 'c', messageId: 'm' }],
    ]);
    await d.run();
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 42, gameId: null, gameName: null }),
    );
  });

  it('does nothing for an untagged event', async () => {
    const d = deps([[eventRow(null)]]);
    await d.run();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('does nothing when the event is gone', async () => {
    const d = deps([[]]);
    await d.run();
    expect(d.notify).not.toHaveBeenCalled();
  });
});
