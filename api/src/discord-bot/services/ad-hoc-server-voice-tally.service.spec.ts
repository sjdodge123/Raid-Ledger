/**
 * ROK-1801 review fixes — the server-triggered spawn's voice tally (Q9):
 * ROK-1711 bot rule, lobby-outranked monitors, server game overrides (Q3).
 */
import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { ServerPresenceSource } from '../../plugins/pelican/presence/server-presence.sink';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { VOICE_THRESHOLD_BOT_ALLOWLIST_ENV } from '../listeners/voice-threshold-count.helpers';
import type { PendingServerPlayers } from './ad-hoc-server-pending';
import {
  ServerPathVoiceTally,
  type ServerPathVoiceCount,
} from './ad-hoc-server-voice-tally.service';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { ServerPresenceRosterService } from './server-presence-roster.service';
import type {
  ServerRoster,
  ServerRosterEntry,
} from './server-presence-roster.helpers';

const GAME = 10;
const SOURCE: ServerPresenceSource = { gameId: GAME, pelicanServerId: 1 };
const PENDING = { players: () => [] } as unknown as PendingServerPlayers;

type Member = { id: string; user: { bot: boolean } };

/** Each `where()` resolves the next queued result set. */
function dbQueue(results: unknown[][]): PostgresJsDatabase<typeof schema> {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(results.shift() ?? []),
  };
  return chain as unknown as PostgresJsDatabase<typeof schema>;
}

function serverEntry(discordUserId: string): ServerRosterEntry {
  return {
    key: `user:${discordUserId}`,
    steamId: `S-${discordUserId}`,
    userId: null,
    discordUserId,
    name: discordUserId,
  };
}

interface World {
  members: Member[];
  presence?: Record<string, number>;
  roster?: ServerRoster;
}

function moduleRefFor(world: World): ModuleRef {
  const channel = {
    isVoiceBased: () => true,
    members: new Map(world.members.map((m) => [m.id, m])),
  };
  const guild = { channels: { cache: new Map([['ch1', channel]]) } };
  const client = { guilds: { cache: new Map([['g1', guild]]) } };
  const fakes = new Map<unknown, unknown>([
    [
      DiscordBotClientService,
      { getClient: () => client, getGuildId: () => 'g1' },
    ],
    [
      PresenceGameDetectorService,
      {
        detectGameForMember: (m: Member) =>
          Promise.resolve({ gameId: world.presence?.[m.id] ?? null }),
      },
    ],
    [
      ServerPresenceRosterService,
      {
        snapshot: () =>
          Promise.resolve(
            world.roster ?? { byGame: new Map(), gameNames: new Map() },
          ),
      },
    ],
  ]);
  return { get: (token: unknown) => fakes.get(token) } as unknown as ModuleRef;
}

function countOf(
  world: World,
  results: unknown[][],
): Promise<ServerPathVoiceCount> {
  const svc = new ServerPathVoiceTally(dbQueue(results), moduleRefFor(world));
  return svc.countFor(SOURCE, PENDING);
}

async function tallyFor(world: World, results: unknown[][]): Promise<number> {
  return (await countOf(world, results)).counted;
}

const MONITOR = [{ channelId: 'ch1' }];

describe('ServerPathVoiceTally — ROK-1711 bot rule (review MAJOR 1)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('skips a plain bot but counts a DEMO_MODE-allowlisted one', async () => {
    process.env.DEMO_MODE = 'true';
    process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV] = 'companion';
    const members = [
      { id: 'human', user: { bot: false } },
      { id: 'music', user: { bot: true } },
      { id: 'companion', user: { bot: true } },
    ];
    expect(await tallyFor({ members }, [MONITOR, []])).toBe(2);
  });
});

describe('ServerPathVoiceTally — lobby-outranked monitors (Codex P2)', () => {
  it('ignores a monitor channel that also carries a general-lobby binding', async () => {
    const members = [{ id: 'u1', user: { bot: false } }];
    expect(await tallyFor({ members }, [MONITOR, [{ channelId: 'ch1' }]])).toBe(
      0,
    );
  });
});

describe('ServerPathVoiceTally — server game overrides (Codex P2 / Q3)', () => {
  it("does not count a presence-null member sitting on another game's server", async () => {
    const roster: ServerRoster = {
      byGame: new Map([[20, [serverEntry('u1')]]]),
      gameNames: new Map([[20, 'Other']]),
    };
    const members = [{ id: 'u1', user: { bot: false } }];
    expect(await tallyFor({ members, roster }, [MONITOR, []])).toBe(0);
  });

  it("counts a member on this game's server whatever their rich presence says", async () => {
    const roster: ServerRoster = {
      byGame: new Map([[GAME, [serverEntry('u1')]]]),
      gameNames: new Map([[GAME, 'Valheim']]),
    };
    const members = [{ id: 'u1', user: { bot: false } }];
    const presence = { u1: 30 };
    expect(await tallyFor({ members, roster, presence }, [MONITOR, []])).toBe(
      1,
    );
  });
});

describe('ServerPathVoiceTally — failure isolation (review MINOR 6)', () => {
  it('returns 0 instead of rejecting when a lookup throws', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as unknown as PostgresJsDatabase<typeof schema>;
    const svc = new ServerPathVoiceTally(db, moduleRefFor({ members: [] }));
    await expect(svc.countFor(SOURCE, PENDING)).resolves.toEqual({
      counted: 0,
      unconfirmed: 0,
    });
  });
});

describe('ServerPathVoiceTally — unconfirmed presence (Codex r3 P2)', () => {
  it('counts a presence-null member as unconfirmed and an on-game one as confirmed', async () => {
    const members = [
      { id: 'u1', user: { bot: false } },
      { id: 'u2', user: { bot: false } },
    ];
    const presence = { u2: GAME };
    expect(await countOf({ members, presence }, [MONITOR, []])).toEqual({
      counted: 2,
      unconfirmed: 1,
    });
  });
});
