/**
 * ROK-1445 AC13/AC14 — `pendingSpawnTimers` is keyed by channelId alone and
 * `scheduleDelayedSpawn` early-returns when a timer already exists for the
 * channel. Once the first group arms its timer the second qualifying group
 * physically cannot arm one, so AC2 (N concurrent events) is unreachable until
 * the map is re-keyed per `(channel, game)`. AC14 then follows: the leave path
 * must cancel per group, not per channel.
 *
 * These assertions read the listener's private `pendingSpawnTimers` map by
 * SIZE, not by key format — the exact key string is the dev's choice.
 *
 * Joins are interleaved (CoD4, Deep Rock, CoD4, Deep Rock) on purpose: a
 * same-game pair joining back-to-back would satisfy `shouldSpawnImmediately`'s
 * channel-wide unanimity check and skip the timer path entirely (AC15).
 */
import {
  BINDING_ID,
  CHANNEL_ID,
  lobbyBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const COD4 = { gameId: 4, gameName: 'Call of Duty 4' };
const DEEP_ROCK = { gameId: 9, gameName: 'Deep Rock Galactic' };

describe('VoiceStateListener — ROK-1445 per-(channel, game) spawn timers', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  /** Two qualifying groups in one lobby, interleaved so neither spawns early. */
  async function twoGroupsArmed(): Promise<void> {
    h = await setupRok1445Harness(lobbyBinding({ config: { minPlayers: 2 } }));
    await h.joinMember({ id: 'u1', ...COD4 });
    await h.joinMember({ id: 'u3', ...DEEP_ROCK });
    await h.joinMember({ id: 'u2', ...COD4 });
    await h.joinMember({ id: 'u4', ...DEEP_ROCK });
  }

  describe('AC13 — the timer map is keyed per (channel, game)', () => {
    it('arms one pending spawn per qualifying group, not one per channel [must-fail-now]', async () => {
      await twoGroupsArmed();

      const keys = h.spawnTimerKeys();
      expect(keys).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);
      expect(keys.every((k) => k.includes(CHANNEL_ID))).toBe(true);
    });

    it('clears every re-keyed timer on disconnect [must-keep-passing]', async () => {
      await twoGroupsArmed();
      expect(h.spawnTimerKeys().length).toBeGreaterThan(0);

      h.listener.onBotDisconnected();

      expect(h.spawnTimerKeys()).toEqual([]);
    });
  });

  describe('AC14 — the leave path cancels per group', () => {
    it('cancels only the group that fell below threshold [must-fail-now]', async () => {
      await twoGroupsArmed();
      expect(h.spawnTimerKeys()).toHaveLength(2);

      // u1 leaves: CoD4 drops to 1 (cancel), Deep Rock is untouched at 2.
      await h.leaveMember('u1');

      expect(h.spawnTimerKeys()).toHaveLength(1);
    });

    it('lets the still-qualifying group spawn, with only its own members [must-fail-now]', async () => {
      await twoGroupsArmed();

      await h.leaveMember('u1');
      await h.advanceSpawnDelay();

      expect(h.eventKeys()).toEqual([`${BINDING_ID}:${DEEP_ROCK.gameId}`]);
      // u2 is still on CoD4 — a Deep Rock roster must never absorb them.
      expect(h.rosterOf(`${BINDING_ID}:${DEEP_ROCK.gameId}`)).toEqual([
        'u3',
        'u4',
      ]);
    });
  });
});
