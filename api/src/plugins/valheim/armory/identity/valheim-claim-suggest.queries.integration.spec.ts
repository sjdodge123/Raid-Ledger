/**
 * ROK-1933 L1 — the claim-suggest scan queries against a real database:
 * which live, unclaimed, Steam-only sightings qualify, and which users are
 * plausible owners (hub member or in voice; active; Discord-linked; no claim
 * on this server; verified Steam not different). Character names invented.
 */
import { eq } from 'drizzle-orm';
import { ValheimCharacterMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import {
  findClaimCandidates,
  findUnclaimedSightings,
  type ClaimSighting,
} from './valheim-claim-suggest.queries';

const STEAM = '76561190000000101';
const OTHER_STEAM = '76561190000000999';
const NAME = 'Brannök';
const MIN = 60_000;
let testApp: TestApp;
let n = 0;

interface World {
  serverId: number;
  guildId: number;
  eventId: number;
  profileId: number;
}

async function insertServer(): Promise<number> {
  n += 1;
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: testApp.seed.game.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

async function insertHub(serverId: number): Promise<number> {
  const name = `Vale ${serverId}`;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_server',
        name,
        nameKey: name.toLowerCase(),
        region: 'server',
        source: 'pelican',
        pelicanServerId: serverId,
      })
      .returning({ id: schema.guilds.id }),
    'hub',
  );
  return row.id;
}

async function insertQuickPlay(status = 'live'): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [new Date(Date.now() - 60 * MIN), new Date()],
        isAdHoc: true,
        adHocStatus: status,
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return row.id;
}

async function insertProfile(
  serverId: number,
  opts: { name?: string; steamId?: string; claimedBy?: number } = {},
): Promise<number> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  n += 1;
  const claim =
    opts.claimedBy === undefined
      ? {}
      : {
          claimedBy: opts.claimedBy,
          claimSource: 'manual' as const,
          claimedAt: new Date(),
        };
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: serverId,
        steamId: opts.steamId ?? STEAM,
        playerId: `${1000 + n}`,
        worldUid: '1234567890123',
        worldName: 'W',
        name: opts.name ?? NAME,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: new Date(),
        equipment: ch.equipment,
        inventory: ch.inventory,
        skills: ch.skills,
        trophies: [],
        knownItems: [],
        knownRecipes: [],
        ...claim,
      })
      .returning({ id: schema.valheimProfiles.id }),
    'profile',
  );
  return row.id;
}

/** A Steam-only server row for the character, first seen `minutesAgo`. */
async function insertSighting(
  w: World,
  minutesAgo = 20,
  extra: Partial<typeof schema.adHocParticipants.$inferInsert> = {},
): Promise<void> {
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId: w.eventId,
    steamId: STEAM,
    discordUsername: NAME,
    characterName: NAME,
    source: 'steam',
    inVoice: false,
    onServer: true,
    pelicanServerId: w.serverId,
    joinedAt: new Date(Date.now() - minutesAgo * MIN),
    ...extra,
  });
}

async function world(): Promise<World> {
  const serverId = await insertServer();
  return {
    serverId,
    guildId: await insertHub(serverId),
    eventId: await insertQuickPlay(),
    profileId: await insertProfile(serverId),
  };
}

async function insertUser(
  username: string,
  opts: {
    discordId?: string | null;
    steamId?: string;
    displayName?: string;
    deactivated?: boolean;
    banned?: boolean;
  } = {},
): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username,
        discordId:
          opts.discordId === undefined ? `d-${username}` : opts.discordId,
        steamId: opts.steamId ?? null,
        displayName: opts.displayName ?? null,
        deactivatedAt: opts.deactivated === true ? new Date() : null,
        bannedAt: opts.banned === true ? new Date() : null,
      })
      .returning({ id: schema.users.id }),
    `user ${username}`,
  );
  return row.id;
}

async function joinHub(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubServerMembers)
    .values({ guildId, userId, source: 'manual', joinedAt: new Date() });
}

async function joinVoice(
  eventId: number,
  userId: number,
  voiceName: string,
): Promise<void> {
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId,
    userId,
    discordUserId: `v-${userId}`,
    discordUsername: voiceName,
    source: 'discord',
    inVoice: true,
  });
}

const sightingOf = (w: World): ClaimSighting => ({
  eventId: w.eventId,
  guildId: w.guildId,
  pelicanServerId: w.serverId,
  profileId: w.profileId,
  steamId: STEAM,
  characterName: NAME,
});

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('findUnclaimedSightings', () => {
  it('returns a live, unclaimed, Steam-only character seen ≥ 10 minutes', async () => {
    const w = await world();
    await insertSighting(w);
    expect(await findUnclaimedSightings(testApp.db, new Date())).toEqual([
      sightingOf(w),
    ]);
  });
});

describe('findUnclaimedSightings — exclusions', () => {
  it.each<[string, (w: World) => Promise<void>]>([
    ['first seen under 10 minutes ago', (w) => insertSighting(w, 3)],
    [
      'no longer on the server',
      (w) => insertSighting(w, 20, { onServer: false }),
    ],
    [
      'linked to an RL user',
      async (w) =>
        insertSighting(w, 20, { userId: await insertUser('linked') }),
    ],
    [
      'a different character name',
      (w) => insertSighting(w, 20, { characterName: 'Halvard' }),
    ],
    [
      'a different Steam id',
      (w) => insertSighting(w, 20, { steamId: OTHER_STEAM }),
    ],
    [
      'an already claimed character',
      async (w) => {
        await testApp.db
          .update(schema.valheimProfiles)
          .set({
            claimedBy: await insertUser('owner'),
            claimSource: 'manual',
            claimedAt: new Date(),
          })
          .where(eq(schema.valheimProfiles.id, w.profileId));
        await insertSighting(w);
      },
    ],
    [
      'an ended Quick Play',
      async (w) => {
        await testApp.db
          .update(schema.events)
          .set({ adHocStatus: 'ended' })
          .where(eq(schema.events.id, w.eventId));
        await insertSighting(w);
      },
    ],
    [
      'a hidden hub',
      async (w) => {
        await testApp.db
          .update(schema.guilds)
          .set({ hiddenAt: new Date() })
          .where(eq(schema.guilds.id, w.guildId));
        await insertSighting(w);
      },
    ],
  ])('skips %s', async (_label, arrange) => {
    const w = await world();
    await arrange(w);
    expect(await findUnclaimedSightings(testApp.db, new Date())).toEqual([]);
  });
});

describe('findClaimCandidates', () => {
  it('lists hub members and voice users with their names', async () => {
    const w = await world();
    const member = await insertUser('morrow', { displayName: 'M✿rrow' });
    const voice = await insertUser('ysolde');
    await joinHub(w.guildId, member);
    await joinVoice(w.eventId, voice, 'Brannok');
    expect(
      await findClaimCandidates(testApp.db, sightingOf(w), new Date()),
    ).toEqual([
      {
        userId: member,
        names: ['morrow', 'M✿rrow'],
        inVoice: false,
        steamId: null,
      },
      {
        userId: voice,
        names: ['ysolde', 'Brannok'],
        inVoice: true,
        steamId: null,
      },
    ]);
  });

  it('keeps a member whose Steam is the character’s or who owns a character elsewhere', async () => {
    const w = await world();
    const sameSteam = await insertUser('halvard', { steamId: STEAM });
    const elsewhere = await insertUser('thistle');
    await insertProfile(await insertServer(), {
      claimedBy: elsewhere,
      steamId: OTHER_STEAM,
    });
    await joinHub(w.guildId, sameSteam);
    await joinHub(w.guildId, elsewhere);
    const ids = (
      await findClaimCandidates(testApp.db, sightingOf(w), new Date())
    ).map((c) => c.userId);
    expect(ids).toEqual([sameSteam, elsewhere]);
  });
});

describe('findClaimCandidates — exclusions', () => {
  it('drops the ineligible', async () => {
    const w = await world();
    const noDiscord = await insertUser('nodiscord', { discordId: null });
    const gone = await insertUser('gone', { deactivated: true });
    const banned = await insertUser('banned', { banned: true });
    const otherSteam = await insertUser('othersteam', { steamId: OTHER_STEAM });
    const owner = await insertUser('owner');
    await insertProfile(w.serverId, {
      name: 'Halvard',
      steamId: OTHER_STEAM,
      claimedBy: owner,
    });
    for (const id of [noDiscord, gone, banned, otherSteam, owner])
      await joinHub(w.guildId, id);
    await insertUser('stranger');
    await joinVoice(
      await insertQuickPlay(),
      await insertUser('elsewhere'),
      'Brannok',
    );
    expect(
      await findClaimCandidates(testApp.db, sightingOf(w), new Date()),
    ).toEqual([]);
  });

  it('drops a member who left the hub', async () => {
    const w = await world();
    const left = await insertUser('left');
    await testApp.db.insert(schema.hubServerMembers).values({
      guildId: w.guildId,
      userId: left,
      source: 'manual',
      joinedAt: null,
      leftAt: new Date(),
    });
    expect(
      await findClaimCandidates(testApp.db, sightingOf(w), new Date()),
    ).toEqual([]);
  });
});
