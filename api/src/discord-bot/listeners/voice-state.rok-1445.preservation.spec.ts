/**
 * ROK-1445 AC12 — preservation guards for the GAME-SPECIFIC binding path.
 *
 * ROK-697 null-counting is reversed for the general-lobby path ONLY. A
 * `game-voice-monitor` channel declares the game to assume toward, so its
 * `getGameFilteredCount` must keep counting presence-null members, and the
 * ROK-1390/ROK-1394 confirmed-count guard + degrade-to-null spawn must keep
 * working exactly as they do today. Every test in the AC12 blocks below is a
 * characterization guard: it passes NOW and must keep passing after the fix.
 *
 * Also pins two of the in-scope tech-debt fold-ins:
 *   TD1 [must-fail-now] `!binding.gameId` treats gameId === 0 as missing.
 *   TD3 [must-fail-now] `[voice-pipe]` printf survivor logs a literal `%s`.
 */
import { Collection } from 'discord.js';
import {
  getGameFilteredCount,
  trackScheduledEventJoin,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';
import {
  gameBinding,
  setupRok1445Harness,
  type Rok1445Harness,
} from './voice-state.rok-1445.spec-helpers';

const CH = 'ch-1';
const GUILD = 'guild-1';

function boundGame(gameId: number | null): ResolvedBinding {
  return {
    bindingId: 'bind-game',
    gameId,
    gameName: 'Rise of Kingdoms',
    bindingPurpose: 'game-voice-monitor',
    recurrenceGroupId: null,
    config: { minPlayers: 2 },
  };
}

/** Minimal deps for `getGameFilteredCount`: a channel plus per-member games. */
function countDeps(detected: Array<[string, number | null]>): VoiceHandlerDeps {
  const games = new Map(detected);
  const members = new Collection<string, unknown>();
  for (const [id] of detected) members.set(id, { id });
  const channels = new Collection<string, unknown>();
  channels.set(CH, { isVoiceBased: () => true, members });
  const guilds = new Collection<string, unknown>();
  guilds.set(GUILD, { channels: { cache: channels } });
  return {
    clientService: {
      getClient: () => ({ guilds: { cache: guilds } }),
      getGuildId: () => GUILD,
    },
    presenceDetector: {
      detectGameForMember: jest.fn((m: { id: string }) =>
        Promise.resolve({
          gameId: games.get(m.id) ?? null,
          gameName: 'whatever',
        }),
      ),
    },
  } as unknown as VoiceHandlerDeps;
}

describe('getGameFilteredCount — ROK-1445 AC12 preservation', () => {
  it('still counts presence-null members toward the threshold [must-keep-passing]', async () => {
    const result = await getGameFilteredCount(
      countDeps([
        ['m1', 1],
        ['m2', null],
      ]),
      CH,
      boundGame(1),
    );

    expect(result).toEqual({
      counted: 2,
      allConfirmed: false,
      confirmedCount: 1,
    });
  });

  it('counts an all-null channel, with zero confirmations (ROK-1394 degrade input) [must-keep-passing]', async () => {
    const result = await getGameFilteredCount(
      countDeps([
        ['m1', null],
        ['m2', null],
      ]),
      CH,
      boundGame(1),
    );

    expect(result).toEqual({
      counted: 2,
      allConfirmed: false,
      confirmedCount: 0,
    });
  });

  it('excludes members positively detected on a different game [must-keep-passing]', async () => {
    const result = await getGameFilteredCount(
      countDeps([
        ['m1', 1],
        ['m2', 7],
      ]),
      CH,
      boundGame(1),
    );

    expect(result).toEqual({
      counted: 1,
      allConfirmed: true,
      confirmedCount: 1,
    });
  });

  it('reports allConfirmed when every member confirmed the bound game [must-keep-passing]', async () => {
    const result = await getGameFilteredCount(
      countDeps([
        ['m1', 1],
        ['m2', 1],
      ]),
      CH,
      boundGame(1),
    );

    expect(result).toEqual({
      counted: 2,
      allConfirmed: true,
      confirmedCount: 2,
    });
  });

  it('TD1 — treats a bound gameId of 0 as a real game, not a missing one [must-fail-now]', async () => {
    const result = await getGameFilteredCount(
      countDeps([
        ['m1', 0],
        ['m2', 0],
      ]),
      CH,
      boundGame(0),
    );

    expect(result).toEqual({
      counted: 2,
      allConfirmed: true,
      confirmedCount: 2,
    });
  });
});

describe('VoiceStateListener — ROK-1445 AC12 game-binding spawn preservation', () => {
  let h: Rok1445Harness;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    h?.teardown();
    jest.useRealTimers();
  });

  it('degrades to a null-game event when the threshold is met with zero confirmations [must-keep-passing]', async () => {
    h = await setupRok1445Harness(gameBinding({ config: { minPlayers: 2 } }));
    await h.joinMember({ id: 'u1', gameId: null });
    await h.joinMember({ id: 'u2', gameId: null });
    await h.advanceSpawnDelay();

    expect(h.eventKeys()).toEqual(['bind-game:null']);
    expect(h.rosterOf('bind-game:null')).toEqual(['u1', 'u2']);
  });

  it('mints the bound game and rosters the presence-null member too [must-keep-passing]', async () => {
    h = await setupRok1445Harness(gameBinding({ config: { minPlayers: 2 } }));
    await h.joinMember({ id: 'u1', gameId: 1, gameName: 'Rise of Kingdoms' });
    await h.joinMember({ id: 'u2', gameId: null });
    await h.advanceSpawnDelay();

    expect(h.eventKeys()).toEqual(['bind-game:1']);
    expect(h.rosterOf('bind-game:1')).toEqual(['u1', 'u2']);
  });
});

describe('trackScheduledEventJoin — ROK-1445 TD3', () => {
  it('interpolates the [voice-pipe] trace instead of logging a literal %s [must-fail-now]', async () => {
    const debug = jest.fn();
    const deps = {
      logger: { debug, log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      voiceAttendanceService: {
        findActiveScheduledEvents: jest
          .fn()
          .mockResolvedValue([{ eventId: 7 }]),
        handleJoin: jest.fn(),
      },
      usersService: { findByDiscordId: jest.fn().mockResolvedValue({ id: 3 }) },
    } as unknown as VoiceHandlerDeps;

    await trackScheduledEventJoin(deps, CH, {
      discordUserId: 'u1',
      discordUsername: 'U1',
      discordAvatarHash: null,
    });

    // NestJS Logger does not substitute printf tokens — the message must
    // already carry the values.
    const message = debug.mock.calls[0]?.[0] as string;
    expect(message).toContain(`channelId=${CH}`);
    expect(message).toContain('activeEvents=1');
    expect(message).not.toContain('%s');
  });
});
