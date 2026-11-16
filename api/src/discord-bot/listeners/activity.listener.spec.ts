/**
 * ActivityListener — launcher presence is not a game (ROK-2204).
 *
 * A launcher such as CurseForge reports as a "Playing" activity. The listener
 * must not buffer a session start/stop for it, while a real game shown next
 * to the launcher is still tracked.
 */
import { ActivityType, type Presence } from 'discord.js';
import { ActivityListener } from './activity.listener';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { GameActivityService } from '../services/game-activity.service';
import type { UsersService } from '../../users/users.service';

type Activity = { name: string; type: ActivityType };

function presence(activities: Activity[]): Presence {
  return { userId: 'discord-1', activities } as unknown as Presence;
}

function build(): {
  listener: ActivityListener;
  bufferStart: jest.Mock;
  bufferStop: jest.Mock;
} {
  const bufferStart = jest.fn();
  const bufferStop = jest.fn();
  const gameActivity = {
    bufferStart,
    bufferStop,
  } as unknown as GameActivityService;
  const users = {
    findByDiscordId: jest.fn().mockResolvedValue({ id: 42 }),
  } as unknown as UsersService;
  const listener = new ActivityListener(
    {} as DiscordBotClientService,
    gameActivity,
    users,
  );
  return { listener, bufferStart, bufferStop };
}

const playing = (name: string): Activity => ({
  name,
  type: ActivityType.Playing,
});

describe('ActivityListener launcher presence (ROK-2204)', () => {
  it('does not buffer a session start for a launcher activity', async () => {
    const { listener, bufferStart } = build();
    await listener['handlePresenceUpdate'](
      presence([]),
      presence([playing('CurseForge')]),
    );
    expect(bufferStart).not.toHaveBeenCalled();
  });

  it('does not buffer a session stop when a launcher closes', async () => {
    const { listener, bufferStop } = build();
    await listener['handlePresenceUpdate'](
      presence([playing(' curseforge ')]),
      presence([]),
    );
    expect(bufferStop).not.toHaveBeenCalled();
  });

  it('still tracks a real game shown next to a launcher', async () => {
    const { listener, bufferStart } = build();
    await listener['handlePresenceUpdate'](
      presence([]),
      presence([playing('CurseForge'), playing('World of Warcraft')]),
    );
    expect(bufferStart).toHaveBeenCalledTimes(1);
    expect(bufferStart).toHaveBeenCalledWith(
      42,
      'World of Warcraft',
      expect.any(Date),
      'presence',
    );
  });
});
