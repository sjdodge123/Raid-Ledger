import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { GameActivityNudge } from './channel-lifecycle.nudge';
import {
  HubActivityNudgeListener,
  readHubGuildId,
} from './hub-activity.nudge.listener';

function setup() {
  const mock = createDrizzleMock();
  const touch = jest.fn();
  const nudge = { touch } as unknown as GameActivityNudge;
  const db = mock as unknown as PostgresJsDatabase<typeof schema>;
  return { mock, touch, listener: new HubActivityNudgeListener(db, nudge) };
}

describe('HubActivityNudgeListener (ROK-1873 D12)', () => {
  it('a community-hub leader post nudges that hub’s game', async () => {
    const { mock, touch, listener } = setup();
    mock.limit.mockResolvedValueOnce([{ gameId: 42 }]);
    await listener.handleLeaderPost({ guildId: 7, postId: 1 });
    expect(touch).toHaveBeenCalledWith(42);
  });

  it('a post on a non-community hub nudges nothing', async () => {
    const { mock, touch, listener } = setup();
    mock.limit.mockResolvedValueOnce([]);
    await listener.handleLeaderPost({ guildId: 7 });
    expect(touch).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it('never throws into the emitter when the lookup fails', async () => {
    const { mock, touch, listener } = setup();
    mock.limit.mockRejectedValueOnce(new Error('db down'));
    await expect(
      listener.handleLeaderPost({ guildId: 7 }),
    ).resolves.toBeUndefined();
    expect(touch).not.toHaveBeenCalled();
  });

  it('reads guildId only when it is a number', () => {
    expect(readHubGuildId({ guildId: 3 })).toBe(3);
    expect(readHubGuildId({ guildId: '3' })).toBeNull();
    expect(readHubGuildId(null)).toBeNull();
  });
});
