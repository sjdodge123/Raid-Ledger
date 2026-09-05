/**
 * ROK-1374 — the readiness data path (spec scenarios 14–18; AC11, AC21,
 * AC22, D11/D12, E19).
 *
 * The card is built from ROSTER-scoped ownership, community-shared sizes and
 * the viewer's private speed. Each case below pins one of those boundaries
 * end to end through the real controllers.
 *
 * Cannot run until migrations 0169/0170 exist (the tie columns and the speed
 * columns). The Lead runs it on the fleet against a throwaway migration until
 * then. Mutations the Lead applies: (14) drop the `userIds` scope from
 * `countOwnersPerGame` → `ownedCount` reads 27, not 7; (16) make
 * `InstallSizeService` INSERT instead of UPDATE → the games row count moves;
 * (18) stop `setConsent(false)` nulling the three speed columns →
 * `estimatedDownloadMinutes` survives revocation.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

type Response = { status: number; body: unknown };
type Member = { userId: number; token: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const INSTALL_BYTES = 46_000_000_000;
const DOWNLOAD_BYTES = 30_000_000_000;
const SPEED_MBPS = 100;
/** 30 GB at 100 Mbps: (30e9 * 8) / 100e6 = 2400 s = 40 min. */
const EXPECTED_MINUTES = 40;

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

// ─── fixture helpers ────────────────────────────────────────────────────────

function expectOk(res: Response, step: string): void {
  if (res.status >= 300) {
    throw new Error(
      `fixture step "${step}" failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

async function member(tag: string): Promise<Member> {
  const m = await createMemberAndLogin(testApp, tag, `${tag}@test.local`);
  return { userId: m.userId, token: m.token };
}

/** A user who is NOT on any roster and never logs in — cheap to make. */
async function bystander(tag: string): Promise<number> {
  const [row] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `local:${tag}`, username: tag, role: 'member' })
    .returning({ id: schema.users.id });
  return row.id;
}

async function createGame(name: string) {
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    })
    .returning();
  return game;
}

async function own(userId: number, gameId: number): Promise<void> {
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source: 'steam_library' });
}

async function createPrivateLineup(inviteeUserIds: number[]): Promise<number> {
  const res = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Readiness Test',
      visibility: 'private',
      inviteeUserIds,
      votesPerPlayer: 1,
    });
  expectOk(res, 'create lineup');
  return (res.body as { id: number }).id;
}

/** Park the lineup on a tie hold directly — the readiness path reads columns. */
async function armTieHold(lineupId: number, gameIds: number[]): Promise<void> {
  const now = new Date();
  await testApp.db
    .update(schema.communityLineups)
    .set({
      status: 'voting',
      tieDetectedAt: now,
      tieGameIds: gameIds,
      tieVoteCount: 1,
      tieExpiresAt: new Date(now.getTime() + 7 * DAY_MS),
    })
    .where(eq(schema.communityLineups.id, lineupId));
}

function readiness(token: string, lineupId: number) {
  return testApp.request
    .get(`/lineups/${lineupId}/tie-readiness`)
    .set('Authorization', `Bearer ${token}`);
}

function setInstallSize(token: string, gameId: number, body: object) {
  return testApp.request
    .put(`/games/${gameId}/install-size`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function setConsent(token: string, consent: boolean) {
  return testApp.request
    .put('/users/me/speed-test-consent')
    .set('Authorization', `Bearer ${token}`)
    .send({ consent });
}

function setSpeed(token: string, body: object) {
  return testApp.request
    .put('/users/me/connection-speed')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function gameOf(body: unknown, gameId: number) {
  const games = (body as { games: Array<{ gameId: number }> }).games;
  const game = games.find((g) => g.gameId === gameId);
  if (!game) throw new Error(`readiness carries no game ${gameId}`);
  return game as {
    gameId: number;
    ownedCount: number;
    rosterSize: number;
    youOwn: boolean;
    installSizeBytes: number | null;
    downloadSizeBytes: number | null;
    installSizeSource: string | null;
    installSizeUpdatedAt: string | null;
    estimatedDownloadMinutes: number | null;
  };
}

async function countGames(): Promise<number> {
  const [row] = await testApp.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.games);
  return row.n;
}

/**
 * The shared fixture: a private lineup with a 9-member roster (admin + 8),
 * two tied games, 7 of the roster owning game A, and 20 bystanders who also
 * own it (the community-wide count the card must NOT show).
 */
async function arrange() {
  const members: Member[] = [];
  for (let i = 0; i < 8; i++) members.push(await member(`ready-${i}`));
  const lineupId = await createPrivateLineup(members.map((m) => m.userId));
  const [gameA, gameB] = [
    await createGame('Deep Rock Galactic'),
    await createGame('Valheim'),
  ];
  // 7 roster owners: the admin + the first six members.
  await own(testApp.seed.adminUser.id, gameA.id);
  for (const m of members.slice(0, 6)) await own(m.userId, gameA.id);
  for (let i = 0; i < 20; i++)
    await own(await bystander(`owner-${i}`), gameA.id);
  await armTieHold(lineupId, [gameA.id, gameB.id]);
  return { lineupId, gameA, gameB, members };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('GET /lineups/:id/tie-readiness (ROK-1374)', () => {
  it('scenario 14 — ownership is scoped to the ROSTER, never the community (AC11)', async () => {
    const { lineupId, gameA, members } = await arrange();

    const asAdmin = await readiness(adminToken, lineupId);
    expect(asAdmin.status).toBe(200);
    const a = gameOf(asAdmin.body, gameA.id);
    expect(a.ownedCount).toBe(7);
    expect(a.rosterSize).toBe(9);
    expect(a.youOwn).toBe(true);
    expect((asAdmin.body as { rosterSize: number }).rosterSize).toBe(9);

    // The two members who do NOT own it see the same shared count, and their
    // own flag says so.
    const asNonOwner = await readiness(members[7].token, lineupId);
    expect(asNonOwner.status).toBe(200);
    expect(gameOf(asNonOwner.body, gameA.id)).toMatchObject({
      ownedCount: 7,
      youOwn: false,
    });
  });

  it('scenario 15 — a game with no size data renders nulls, never zero, and still 200s (AC22/D12)', async () => {
    const { lineupId, gameB } = await arrange();

    const res = await readiness(adminToken, lineupId);
    expect(res.status).toBe(200);
    expect(gameOf(res.body, gameB.id)).toMatchObject({
      installSizeBytes: null,
      downloadSizeBytes: null,
      installSizeSource: null,
      installSizeUpdatedAt: null,
      estimatedDownloadMinutes: null,
    });
  });

  it('scenario 16 — a manual install size is community-shared, stamped, and performs NO insert into games', async () => {
    const { lineupId, gameA, members } = await arrange();
    const before = await countGames();

    expectOk(
      await setInstallSize(members[0].token, gameA.id, {
        installSizeBytes: INSTALL_BYTES,
        downloadSizeBytes: DOWNLOAD_BYTES,
      }),
      'set install size',
    );

    expect(await countGames()).toBe(before);
    const seenByAnother = gameOf(
      (await readiness(members[7].token, lineupId)).body,
      gameA.id,
    );
    expect(seenByAnother.installSizeBytes).toBe(INSTALL_BYTES);
    expect(seenByAnother.downloadSizeBytes).toBe(DOWNLOAD_BYTES);
    expect(seenByAnother.installSizeSource).toBe('manual');
    const stampedAgoMs =
      Date.now() -
      new Date(seenByAnother.installSizeUpdatedAt as string).getTime();
    expect(stampedAgoMs).toBeGreaterThanOrEqual(0);
    expect(stampedAgoMs).toBeLessThan(10_000);
  });

  it('scenario 17 — a user off the roster gets 403 (AC21); no hold at all is 404', async () => {
    const outsider = await member('outsider');
    const { lineupId } = await arrange();
    expect((await readiness(outsider.token, lineupId)).status).toBe(403);

    const bare = await createPrivateLineup([outsider.userId]);
    expect((await readiness(outsider.token, bare)).status).toBe(404);
  });

  it('scenario 18 — the estimate needs consent + a speed; revoking consent deletes the datum (AC21/E19)', async () => {
    const { lineupId, gameA, members } = await arrange();
    const viewer = members[0];
    expectOk(
      await setInstallSize(adminToken, gameA.id, {
        installSizeBytes: INSTALL_BYTES,
        downloadSizeBytes: DOWNLOAD_BYTES,
      }),
      'set install size',
    );

    // An ndt7 figure without consent is refused outright.
    expect(
      (
        await setSpeed(viewer.token, {
          downstreamMbps: SPEED_MBPS,
          source: 'ndt7',
        })
      ).status,
    ).toBe(403);

    expectOk(await setConsent(viewer.token, true), 'grant consent');
    expectOk(
      await setSpeed(viewer.token, {
        downstreamMbps: SPEED_MBPS,
        source: 'ndt7',
      }),
      'set speed',
    );
    const withSpeed = await readiness(viewer.token, lineupId);
    expect(withSpeed.status).toBe(200);
    expect(
      (withSpeed.body as { viewerSpeedMbps: number }).viewerSpeedMbps,
    ).toBe(SPEED_MBPS);
    expect(gameOf(withSpeed.body, gameA.id).estimatedDownloadMinutes).toBe(
      EXPECTED_MINUTES,
    );

    expectOk(await setConsent(viewer.token, false), 'revoke consent');
    const [row] = await testApp.db
      .select({
        mbps: schema.users.connectionDownstreamMbps,
        source: schema.users.connectionSpeedSource,
        measuredAt: schema.users.connectionSpeedMeasuredAt,
        consentAt: schema.users.speedTestConsentAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, viewer.userId));
    expect(row).toEqual({
      mbps: null,
      source: null,
      measuredAt: null,
      consentAt: null,
    });
    const revoked = await readiness(viewer.token, lineupId);
    expect(
      (revoked.body as { viewerSpeedMbps: number | null }).viewerSpeedMbps,
    ).toBeNull();
    expect(gameOf(revoked.body, gameA.id).estimatedDownloadMinutes).toBeNull();
  });
});
