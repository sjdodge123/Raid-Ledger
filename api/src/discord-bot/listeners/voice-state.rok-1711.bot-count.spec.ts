/**
 * ROK-1711 — `getGameFilteredCount` must not count Discord bots toward a game
 * binding's `minPlayers`, except allowlisted bot ids under DEMO_MODE, while
 * presence-null humans keep counting (ROK-697).
 */
import { Collection } from 'discord.js';
import {
  getGameFilteredCount,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import type { ResolvedBinding } from './voice-state.helpers';
import { VOICE_THRESHOLD_BOT_ALLOWLIST_ENV } from './voice-threshold-count.helpers';

const CH = 'ch-1';
const GUILD = 'guild-1';
const BOUND: ResolvedBinding = {
  bindingId: 'bind-game',
  gameId: 1,
  gameName: 'Rise of Kingdoms',
  bindingPurpose: 'game-voice-monitor',
  recurrenceGroupId: null,
  config: { minPlayers: 2, allowJustChatting: true },
};

interface FakeMember {
  id: string;
  bot: boolean;
  gameId: number | null;
}

/** Deps whose channel holds the given members, each with a detected game. */
function countDeps(members: FakeMember[]): VoiceHandlerDeps {
  const games = new Map(members.map((m) => [m.id, m.gameId]));
  const voice = new Collection<string, unknown>();
  for (const m of members) voice.set(m.id, { id: m.id, user: { bot: m.bot } });
  const channels = new Collection<string, unknown>();
  channels.set(CH, { isVoiceBased: () => true, members: voice });
  const guilds = new Collection<string, unknown>();
  guilds.set(GUILD, { channels: { cache: channels } });
  return {
    clientService: {
      getClient: () => ({ guilds: { cache: guilds } }),
      getGuildId: () => GUILD,
    },
    presenceDetector: {
      detectGameForMember: jest.fn((m: { id: string }) =>
        Promise.resolve({ gameId: games.get(m.id) ?? null, gameName: 'x' }),
      ),
    },
  } as unknown as VoiceHandlerDeps;
}

const HUMAN_PLUS_BOT: FakeMember[] = [
  { id: 'human', bot: false, gameId: 1 },
  { id: 'music-bot', bot: true, gameId: null },
];

const SAVED = {
  demo: process.env.DEMO_MODE,
  allow: process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV],
};

/** Restore one env var to its pre-suite value. */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Count the channel holding one human on the game plus an idle bot. */
function countHumanPlusBot() {
  return getGameFilteredCount(countDeps(HUMAN_PLUS_BOT), CH, BOUND);
}

describe('getGameFilteredCount — ROK-1711 bot exclusion', () => {
  afterEach(() => {
    restoreEnv('DEMO_MODE', SAVED.demo);
    restoreEnv(VOICE_THRESHOLD_BOT_ALLOWLIST_ENV, SAVED.allow);
  });

  it('counts a human plus a non-allowlisted bot as 1 (below minPlayers 2)', async () => {
    process.env.DEMO_MODE = 'true';
    process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV] = 'some-other-bot';

    const result = await countHumanPlusBot();

    expect(result).toEqual({
      counted: 1,
      allConfirmed: true,
      confirmedCount: 1,
    });
  });

  it('counts an allowlisted bot under DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'true';
    process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV] = ' other , music-bot ';

    const result = await countHumanPlusBot();

    expect(result).toEqual({
      counted: 2,
      allConfirmed: false,
      confirmedCount: 1,
    });
  });

  it('ignores the allowlist when DEMO_MODE is off', async () => {
    delete process.env.DEMO_MODE;
    process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV] = 'music-bot';

    const result = await countHumanPlusBot();

    expect(result.counted).toBe(1);
  });

  it('still counts presence-null humans (ROK-697)', async () => {
    delete process.env.DEMO_MODE;

    const result = await getGameFilteredCount(
      countDeps([
        { id: 'h1', bot: false, gameId: 1 },
        { id: 'h2', bot: false, gameId: null },
        { id: 'bot', bot: true, gameId: null },
      ]),
      CH,
      BOUND,
    );

    expect(result).toEqual({
      counted: 2,
      allConfirmed: false,
      confirmedCount: 1,
    });
  });
});
