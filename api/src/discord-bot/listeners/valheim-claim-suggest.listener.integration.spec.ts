/**
 * ROK-1933 L3 — the claim-DM buttons against a real database.
 *
 * Bots cannot press another bot's DM buttons (CLAUDE.md "Key limitation"),
 * so the handler is invoked directly with a constructed interaction, as
 * `lfg-invite-decline.integration.spec.ts` does. Identity comes from the
 * interaction's Discord id; the pair key the DM scan writes marks who was
 * asked. All names are invented.
 */
import { and, eq } from 'drizzle-orm';
import { ValheimCharacterMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { fakeServer } from '../../plugins/pelican/testing/pelican-fixtures';
import { loadValheimFixture } from '../../plugins/valheim/link/ingest/valheim-link-ingest.testing';
import {
  CLAIM_REPLY_COPY,
  CLAIM_SUGGEST_THROTTLE_TTL_SECONDS,
  claimSuggestKeys,
} from '../../plugins/valheim/armory/identity/valheim-claim-suggest.copy';
import { ValheimClaimSuggestListener } from './valheim-claim-suggest.listener';

const NAME = 'Quillavar';
let testApp: TestApp;
let listener: ValheimClaimSuggestListener;
let dedup: NotificationDedupService;
let n = 0;
/** Every key a test marked; released after it (the truncate keeps Redis). */
const touched: string[] = [];

beforeAll(async () => {
  testApp = await getTestApp();
  listener = testApp.app.get(ValheimClaimSuggestListener);
  dedup = testApp.app.get(NotificationDedupService);
});

afterEach(async () => {
  await dedup.releaseKeys(touched.splice(0));
  testApp.seed = await truncateAllTables(testApp.db);
});

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
  const hub = `Mistvale ${row.id}`;
  await testApp.db.insert(schema.guilds).values({
    gameId: testApp.seed.game.id,
    kind: 'game_server',
    name: hub,
    nameKey: hub.toLowerCase(),
    region: 'server',
    source: 'pelican',
    pelicanServerId: row.id,
  });
  return row.id;
}

async function insertProfile(claimedBy?: number): Promise<number> {
  const serverId = await insertServer();
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  const claim =
    claimedBy === undefined
      ? {}
      : { claimedBy, claimSource: 'manual' as const, claimedAt: new Date() };
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.valheimProfiles)
      .values({
        pelicanServerId: serverId,
        steamId: `7656119000000${2000 + n}`,
        playerId: `${3000 + n}`,
        worldUid: '9876543210123',
        worldName: 'W',
        name: NAME,
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

async function insertUser(): Promise<{ userId: number; discordId: string }> {
  n += 1;
  const discordId = `${200_000_000_000_000_000n + BigInt(n)}`;
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ username: `wanderer${n}`, discordId })
      .returning({ id: schema.users.id }),
    'user',
  );
  return { userId: row.id, discordId };
}

/** Mark a key the way the DM scan does, and remember it for teardown. */
async function mark(key: string, ttl: number | null): Promise<void> {
  touched.push(key);
  await dedup.checkAndMarkSent(key, ttl);
}

/** The scan asked `userId` about `profileId` (pair + per-character keys). */
async function asked(profileId: number, userId: number): Promise<void> {
  await mark(claimSuggestKeys.pair(profileId, userId), null);
  await mark(
    claimSuggestKeys.profile(profileId),
    CLAIM_SUGGEST_THROTTLE_TTL_SECONDS,
  );
}

function press(customId: string, discordId: string) {
  const deferUpdate = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const followUp = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    customId,
    user: { id: discordId },
    deferUpdate,
    editReply,
    followUp,
  } as never;
  return { interaction, deferUpdate, editReply, followUp };
}

async function ownerOf(profileId: number) {
  const [row] = nonEmpty(
    await testApp.db
      .select({
        claimedBy: schema.valheimProfiles.claimedBy,
        claimSource: schema.valheimProfiles.claimSource,
      })
      .from(schema.valheimProfiles)
      .where(eq(schema.valheimProfiles.id, profileId)),
    'profile row',
  );
  return row;
}

function claimEvents(profileId: number, toUserId: number) {
  return testApp.db
    .select()
    .from(schema.valheimProfileClaimEvents)
    .where(
      and(
        eq(schema.valheimProfileClaimEvents.profileId, profileId),
        eq(schema.valheimProfileClaimEvents.toUserId, toUserId),
      ),
    );
}

describe('ValheimClaimSuggestListener Yes / Not me (ROK-1933 L3)', () => {
  it('Yes claims the character as a manual claim, audits it and edits the DM', async () => {
    const a = await insertUser();
    const profileId = await insertProfile();
    await asked(profileId, a.userId);

    const p = press(`vclaim:yes:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(p.interaction);

    expect(p.deferUpdate).toHaveBeenCalledTimes(1);
    expect(await ownerOf(profileId)).toEqual({
      claimedBy: a.userId,
      claimSource: 'manual',
    });
    const events = await claimEvents(profileId, a.userId);
    expect(events.map((e) => `${e.action} by ${e.actorUserId}`)).toEqual([
      `claim by ${a.userId}`,
    ]);
    expect(p.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(`Claimed — ${NAME} is yours.`),
      components: [],
    });
    expect(p.editReply.mock.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining(`/valheim/characters/${profileId}`),
    });
  });

  it('Not me suppresses the pair forever and frees the character for the next candidate', async () => {
    const a = await insertUser();
    const profileId = await insertProfile();
    await asked(profileId, a.userId);
    const declined = claimSuggestKeys.declined(profileId, a.userId);
    touched.push(declined);

    const p = press(`vclaim:no:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(p.interaction);

    const keys = {
      declined: await dedup.isMarked(declined),
      characterThrottle: await dedup.isMarked(
        claimSuggestKeys.profile(profileId),
      ),
    };
    expect(keys).toEqual({ declined: true, characterThrottle: false });
    expect((await ownerOf(profileId)).claimedBy).toBeNull();
    expect(p.editReply).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.declined(NAME),
      components: [],
    });
  });
});

describe('ValheimClaimSuggestListener — repeat Not me and hidden hub (ROK-1933 review)', () => {
  it('a second Not me press keeps the next candidate’s 24h character key', async () => {
    const a = await insertUser();
    const b = await insertUser();
    const profileId = await insertProfile();
    await asked(profileId, a.userId);
    touched.push(claimSuggestKeys.declined(profileId, a.userId));
    await listener.handleButtonInteraction(
      press(`vclaim:no:${profileId}`, a.discordId).interaction,
    );
    await asked(profileId, b.userId);

    const again = press(`vclaim:no:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(again.interaction);

    expect(await dedup.isMarked(claimSuggestKeys.profile(profileId))).toBe(
      true,
    );
  });

  it('Yes on a character whose hub is hidden is refused and claims nothing', async () => {
    const a = await insertUser();
    const profileId = await insertProfile();
    await asked(profileId, a.userId);
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.kind, 'game_server'));

    const p = press(`vclaim:yes:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(p.interaction);

    expect((await ownerOf(profileId)).claimedBy).toBeNull();
    expect(await claimEvents(profileId, a.userId)).toHaveLength(0);
    expect(p.editReply).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.unavailable,
      components: [],
    });
  });
});

describe('ValheimClaimSuggestListener — already claimed and wrong clicker (ROK-1933 L3)', () => {
  it('Yes on a character someone else claimed answers with the 409 copy and changes nothing', async () => {
    const a = await insertUser();
    const owner = await insertUser();
    const profileId = await insertProfile(owner.userId);
    await asked(profileId, a.userId);

    const p = press(`vclaim:yes:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(p.interaction);

    expect((await ownerOf(profileId)).claimedBy).toBe(owner.userId);
    expect(await claimEvents(profileId, a.userId)).toHaveLength(0);
    expect(p.editReply).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.takenByOther(NAME),
      components: [],
    });
  });

  it('Yes on a character the clicker already owns says so', async () => {
    const a = await insertUser();
    const profileId = await insertProfile(a.userId);
    await asked(profileId, a.userId);

    const p = press(`vclaim:yes:${profileId}`, a.discordId);
    await listener.handleButtonInteraction(p.interaction);

    expect(p.editReply).toHaveBeenCalledWith({
      content: CLAIM_REPLY_COPY.alreadyYours,
      components: [],
    });
  });

  it('a press by a user the DM did not ask is refused ephemerally and claims nothing', async () => {
    const a = await insertUser();
    const stranger = await insertUser();
    const profileId = await insertProfile();
    await asked(profileId, a.userId);

    for (const discordId of [stranger.discordId, '299999999999999999']) {
      const p = press(`vclaim:yes:${profileId}`, discordId);
      await listener.handleButtonInteraction(p.interaction);
      expect(p.editReply).not.toHaveBeenCalled();
      expect(p.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: CLAIM_REPLY_COPY.notForYou }),
      );
    }
    expect((await ownerOf(profileId)).claimedBy).toBeNull();
    expect(
      await dedup.isMarked(
        claimSuggestKeys.declined(profileId, stranger.userId),
      ),
    ).toBe(false);
  });
});
