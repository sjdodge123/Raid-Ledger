/**
 * Community Lineup Integration Tests (ROK-933)
 *
 * Verifies lineup CRUD and status transitions against a real PostgreSQL
 * database via HTTP endpoints, including auth guard enforcement.
 */
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

function describeLineups() {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── Helpers ──────────────────────────────────────────────────

  async function loginAsOperator(): Promise<string> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('OperatorPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:operator@test.local',
        username: 'operator',
        role: 'operator',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'operator@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'operator@test.local', password: 'OperatorPass1!' });
    return res.body.access_token as string;
  }

  async function loginAsMember(): Promise<string> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:member@test.local',
        username: 'member',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'member@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'member@test.local', password: 'MemberPass1!' });
    return res.body.access_token as string;
  }

  async function createLineup(token: string) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Lineup Test' });
  }

  async function addEntry(lineupId: number, gameId: number, userId: number) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId,
      nominatedBy: userId,
    });
  }

  // ── POST /lineups ────────────────────────────────────────────

  function describePOST() {
    it('should create a lineup and return detail', async () => {
      const res = await createLineup(adminToken);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        status: 'building',
        entries: [],
        totalVoters: 0,
      });
    });

    it('should accept targetDate', async () => {
      const res = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Target Date Test',
          targetDate: '2026-04-15T00:00:00Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.targetDate).toBeTruthy();
    });

    it('should persist lineup in DB', async () => {
      await createLineup(adminToken);

      const rows = await testApp.db.select().from(schema.communityLineups);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('building');
    });

    it('should allow creating a second active lineup (ROK-1065)', async () => {
      // ROK-1065 removed the 409 single-active constraint — multiple
      // concurrent lineups are now allowed (private ones coexist with public).
      await createLineup(adminToken);
      const res = await createLineup(adminToken);

      expect(res.status).toBe(201);
    });

    it('should require authentication', async () => {
      const res = await testApp.request.post('/lineups').send({});
      expect(res.status).toBe(401);
    });

    it('should reject member role', async () => {
      const memberToken = await loginAsMember();
      const res = await createLineup(memberToken);
      expect(res.status).toBe(403);
    });

    it('should allow operator role', async () => {
      const opToken = await loginAsOperator();
      const res = await createLineup(opToken);
      expect(res.status).toBe(201);
    });
  }
  describe('POST /lineups', describePOST);

  // ── GET /lineups/active ──────────────────────────────────────

  function describeGETActive() {
    it('should return the active lineup as an array (ROK-1065)', async () => {
      await createLineup(adminToken);
      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('building');
    });

    it('should return an empty array when no active lineup (ROK-1065)', async () => {
      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${adminToken}`);

      // ROK-1065: endpoint now always 200 — empty array when no lineups.
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should be accessible to members', async () => {
      await createLineup(adminToken);
      const memberToken = await loginAsMember();

      const res = await testApp.request
        .get('/lineups/active')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should require authentication', async () => {
      const res = await testApp.request.get('/lineups/active');
      expect(res.status).toBe(401);
    });
  }
  describe('GET /lineups/active', describeGETActive);

  // ── GET /lineups/:id ─────────────────────────────────────────

  function describeGETById() {
    it('should return lineup detail with entries', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Add an entry directly in DB
      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0]).toMatchObject({
        gameId: testApp.seed.game.id,
        gameName: 'Test Game',
        voteCount: 0,
        carriedOver: false,
      });
    });

    it('should include vote counts', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);

      // Add a vote
      await testApp.db.insert(schema.communityLineupVotes).values({
        lineupId,
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
      });

      const res = await testApp.request
        .get(`/lineups/${lineupId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.entries[0].voteCount).toBe(1);
      expect(res.body.totalVoters).toBe(1);
    });

    it('should return 404 for nonexistent lineup', async () => {
      const res = await testApp.request
        .get('/lineups/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  }
  describe('GET /lineups/:id', describeGETById);

  // ── PATCH /lineups/:id/status ────────────────────────────────

  function describePATCHStatus() {
    it('should transition building → voting', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('voting');
    });

    it('should set votingDeadline on building → voting', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;
      const deadline = '2026-04-01T00:00:00Z';

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting', votingDeadline: deadline });

      expect(res.status).toBe(200);
      expect(res.body.votingDeadline).toBeTruthy();
    });

    it('should transition voting → decided with decidedGameId', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Add entry and move to voting
      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      // Now decide
      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('decided');
      expect(res.body.decidedGameId).toBe(testApp.seed.game.id);
      expect(res.body.decidedGameName).toBe('Test Game');
    });

    it('should transition decided → archived', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('archived');
    });

    it('should reject invalid transition building → decided', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });

      expect(res.status).toBe(400);
    });

    it('should allow reversion voting → building', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'building' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('building');
    });

    it('should allow reversion archived → decided', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('decided');
    });

    it('should reject decidedGameId not in entries', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;

      // Create a second game not in the lineup
      const [otherGame] = await testApp.db
        .insert(schema.games)
        .values({ name: 'Other Game', slug: 'other-game' })
        .returning();

      await addEntry(lineupId, testApp.seed.game.id, testApp.seed.adminUser.id);
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: otherGame.id });

      expect(res.status).toBe(400);
    });

    it('should reject member role', async () => {
      const createRes = await createLineup(adminToken);
      const lineupId = createRes.body.id as number;
      const memberToken = await loginAsMember();

      const res = await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(403);
    });

    it('should return 404 for nonexistent lineup', async () => {
      const res = await testApp.request
        .patch('/lineups/99999/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      expect(res.status).toBe(404);
    });
  }
  describe('PATCH /lineups/:id/status', describePATCHStatus);

  // ── Active lineup constraint (cross-endpoint) ────────────────

  function describeActiveConstraint() {
    it('should allow creating after archiving previous lineup', async () => {
      // Create → vote → decide → archive
      const res1 = await createLineup(adminToken);
      const id = res1.body.id as number;
      await addEntry(id, testApp.seed.game.id, testApp.seed.adminUser.id);

      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'decided', decidedGameId: testApp.seed.game.id });
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'archived' });

      // Now create a new one — should succeed
      const res2 = await createLineup(adminToken);
      expect(res2.status).toBe(201);
    });

    it('should permit creating while another lineup is in voting (ROK-1065)', async () => {
      // ROK-1065: the single-active-lineup constraint is gone. Private and
      // public lineups can coexist at any phase.
      const res1 = await createLineup(adminToken);
      const id = res1.body.id as number;
      await testApp.request
        .patch(`/lineups/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res2 = await createLineup(adminToken);
      expect(res2.status).toBe(201);
    });
  }
  describe('Active lineup constraint', describeActiveConstraint);

  // ── ROK-1064: per-lineup Discord channel override ───────────
  //
  // Feature spec: lineup creation accepts an optional channelOverrideId.
  // When set, lifecycle embeds post to that channel instead of the guild-bound
  // default channel. If the bot loses perms on the override channel, dispatch
  // falls back to the bound channel and logs exactly one dedup'd warning.

  /** Discord snowflakes (17-20 digits). */
  const BOUND_CHANNEL_ID = '123456789012345678';
  const OVERRIDE_CHANNEL_ID = '987654321098765432';

  /**
   * Build a fake Discord Guild whose cache resolves OVERRIDE_CHANNEL_ID to a
   * text channel with controllable permissions. Used to stand in for the real
   * discord.js Guild without connecting the bot.
   */
  function buildFakeGuild(opts: { hasPerms: boolean }) {
    const fakeChannel = {
      id: OVERRIDE_CHANNEL_ID,
      name: 'lineup-override',
      isTextBased: () => true,
      isThread: () => false,
      isDMBased: () => false,
      permissionsFor: () => ({
        has: () => opts.hasPerms,
      }),
    };
    return {
      members: {
        me: {
          permissionsIn: () => ({ has: () => opts.hasPerms }),
        },
      },
      channels: {
        cache: {
          get: (id: string) =>
            id === OVERRIDE_CHANNEL_ID ? fakeChannel : null,
        },
      },
    } as unknown;
  }

  /** Seed the guild-bound default channel setting. */
  async function seedBoundChannel(): Promise<void> {
    const settings = testApp.app.get(SettingsService);
    await settings.setDiscordBotDefaultChannel(BOUND_CHANNEL_ID);
  }

  /** Create a lineup via HTTP with an optional channelOverrideId. */
  async function createLineupWithOverride(
    channelOverrideId?: string | null,
  ): Promise<number> {
    const body: Record<string, unknown> = { title: 'Override Test' };
    if (channelOverrideId !== undefined) {
      body.channelOverrideId = channelOverrideId;
    }
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  /** Poll until `predicate()` is truthy or we exceed `timeoutMs`. */
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 1000,
  ): Promise<void> {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function describeROK1064() {
    let sendEmbedSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
      const botClient = testApp.app.get(DiscordBotClientService);
      // Stub sendEmbed so we don't hit a real Discord API and so we can
      // assert on the channelId argument.
      sendEmbedSpy = jest
        .spyOn(botClient, 'sendEmbed')
        .mockResolvedValue({ id: 'mock-msg-id' } as never);
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await seedBoundChannel();
    });

    afterEach(() => {
      sendEmbedSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('posts lineup-created embed to override channel when channelOverrideId is set', async () => {
      const botClient = testApp.app.get(DiscordBotClientService);
      jest
        .spyOn(botClient, 'getGuild')
        .mockReturnValue(
          buildFakeGuild({ hasPerms: true }) as ReturnType<
            DiscordBotClientService['getGuild']
          >,
        );

      await createLineupWithOverride(OVERRIDE_CHANNEL_ID);
      // POST fires notifyLineupCreated in the background; poll until it lands.
      await waitFor(() => sendEmbedSpy.mock.calls.length >= 1);

      expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
      const [channelArg] = sendEmbedSpy.mock.calls[0];
      expect(channelArg).toBe(OVERRIDE_CHANNEL_ID);
      expect(channelArg).not.toBe(BOUND_CHANNEL_ID);
    });

    it('posts lineup-created embed to bound channel when no override is set', async () => {
      const botClient = testApp.app.get(DiscordBotClientService);
      jest
        .spyOn(botClient, 'getGuild')
        .mockReturnValue(
          buildFakeGuild({ hasPerms: true }) as ReturnType<
            DiscordBotClientService['getGuild']
          >,
        );

      await createLineupWithOverride(undefined);
      await waitFor(() => sendEmbedSpy.mock.calls.length >= 1);

      expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
      const [channelArg] = sendEmbedSpy.mock.calls[0];
      expect(channelArg).toBe(BOUND_CHANNEL_ID);
    });

    it('falls back to bound channel and warns once when bot lacks perms on override', async () => {
      const botClient = testApp.app.get(DiscordBotClientService);
      jest
        .spyOn(botClient, 'getGuild')
        .mockReturnValue(
          buildFakeGuild({ hasPerms: false }) as ReturnType<
            DiscordBotClientService['getGuild']
          >,
        );

      const lineupId = await createLineupWithOverride(OVERRIDE_CHANNEL_ID);
      await waitFor(() => sendEmbedSpy.mock.calls.length >= 1);

      // Sent to bound channel, NOT the override.
      expect(sendEmbedSpy).toHaveBeenCalledTimes(1);
      const [channelArg] = sendEmbedSpy.mock.calls[0];
      expect(channelArg).toBe(BOUND_CHANNEL_ID);

      // Exactly one warning logged for this (lineupId, channelId) pair.
      const fallbackWarns = warnSpy.mock.calls.filter((call) => {
        const msg = String(call[0] ?? '');
        return (
          msg.includes(String(lineupId)) && msg.includes(OVERRIDE_CHANNEL_ID)
        );
      });
      expect(fallbackWarns).toHaveLength(1);
    });
  }
  describe('ROK-1064: per-lineup channel override', describeROK1064);
}
describe('Lineups (integration)', describeLineups);
