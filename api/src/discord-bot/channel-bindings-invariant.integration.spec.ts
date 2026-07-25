/**
 * Channel Bindings — invariant guard + app-side normalization + health endpoint
 * integration tests (ROK-1415, B3-5). NEW FILE.
 *
 * WHY A NEW FILE: `channel-bindings.integration.spec.ts` is 598/750 counted
 * lines post-B2; this describe (7 cases + fixtures) would breach the 750-line
 * cap for spec files, so the B3-5 matrix lands here per the batch-plan escape
 * hatch ("if the additions would breach 750, put the new describe in a NEW file
 * and say so"). All cases are `// Regression: ROK-1415`.
 *
 * FAILS-BY-CONSTRUCTION: the guard call sites, the `normalizeAndDeleteGames`
 * helper, and the `GET …/bindings/health` endpoint do not exist yet, so every
 * case is RED until B3 is implemented. The one exception is case 3 (the repair
 * path), a PIN that must return 200 both before and after the fix.
 *
 * Drives the guarded write paths + health over HTTP (real controller, real
 * AdminGuard) with a stubbed bot guild id; drives the app-side game-delete
 * normalizer through the service helper directly (there is no HTTP games-delete
 * endpoint — the only app-side game deletes are the IGDB dedup helpers, which
 * reassign FKs before deleting and so never orphan a binding on their own).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from './discord-bot-client.service';
import { normalizeAndDeleteGames } from './services/channel-bindings-invariant.helpers';

const GUILD = 'rok1415-guild';
const CHANNEL = 'rok1415-voice-channel';

let testApp: TestApp;
let token: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  // The admin binding endpoints resolve the guild from the connected bot; stub
  // it so the seeded (guildId=GUILD) rows are in scope for POST/PATCH/health.
  const client = testApp.app.get(DiscordBotClientService);
  jest.spyOn(client, 'getGuildId').mockReturnValue(GUILD);
  token = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

const cb = schema.channelBindings;
const auth = () => ({ Authorization: `Bearer ${token}` });

/** Raw-insert a single non-series voice binding on the shared test channel. */
async function insertBinding(o: {
  bindingPurpose: 'game-voice-monitor' | 'general-lobby' | 'game-announcements';
  gameId: number | null;
  channelId?: string;
}): Promise<typeof cb.$inferSelect> {
  const [row] = await testApp.db
    .insert(cb)
    .values({
      guildId: GUILD,
      channelId: o.channelId ?? CHANNEL,
      channelType: 'voice',
      bindingPurpose: o.bindingPurpose,
      gameId: o.gameId,
      recurrenceGroupId: null,
      config: {},
    })
    .returning();
  return row;
}

/** Insert a throwaway game we can delete without touching the seeded one. */
async function makeGame(
  name: string,
): Promise<typeof schema.games.$inferSelect> {
  const [g] = await testApp.db
    .insert(schema.games)
    .values({
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      igdbId: null,
    })
    .returning();
  return g;
}

interface HealthResponse {
  data: Array<{ id: string; channelId: string; code: string; message: string }>;
  adHocEventsEnabled?: boolean;
  logLevels?: unknown;
}

/** GET the health endpoint (RED today — the route does not exist → 404). */
async function getHealth(): Promise<HealthResponse> {
  const res = await testApp.request
    .get('/admin/discord/bindings/health')
    .set(auth());
  expect(res.status).toBe(200);
  return res.body as HealthResponse;
}

async function bindingsOnChannel(): Promise<(typeof cb.$inferSelect)[]> {
  return testApp.db.select().from(cb).where(eq(cb.channelId, CHANNEL));
}

describe('Channel binding invariant guard (Regression: ROK-1415)', () => {
  // (1) The write path rejects the inert triple at creation.
  it('POST {voice, game-voice-monitor, gameId:null} → 400 BINDING_MONITOR_REQUIRES_GAME and inserts no row', async () => {
    const res = await testApp.request
      .post('/admin/discord/bindings')
      .set(auth())
      .send({
        channelId: CHANNEL,
        channelType: 'voice',
        bindingPurpose: 'game-voice-monitor',
        gameId: null,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BINDING_MONITOR_REQUIRES_GAME');
    expect(await bindingsOnChannel()).toHaveLength(0);
  });

  // (2) The second, undocumented route in: flipping purpose on the stored row.
  it('PATCH null-game general-lobby → game-voice-monitor → 400, purpose unchanged', async () => {
    const b = await insertBinding({
      bindingPurpose: 'general-lobby',
      gameId: null,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ bindingPurpose: 'game-voice-monitor' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BINDING_MONITOR_REQUIRES_GAME');

    const [after] = await testApp.db.select().from(cb).where(eq(cb.id, b.id));
    expect(after.bindingPurpose).toBe('general-lobby');
  });

  // (3) PIN — the repair path must NEVER be blocked (200 before and after fix).
  it('PATCH monitor-with-game → general-lobby → 200 (repair path never blocked)', async () => {
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ bindingPurpose: 'general-lobby' });

    expect(res.status).toBe(200);
    const [after] = await testApp.db.select().from(cb).where(eq(cb.id, b.id));
    expect(after.bindingPurpose).toBe('general-lobby');
  });
});

describe('App-side game delete normalization (Regression: ROK-1415)', () => {
  // (4a) App path: deleting a monitor binding's game normalizes it to lobby.
  it('normalizes an orphaned monitor binding to general-lobby and leaves health clean', async () => {
    const game = await makeGame('Doomed Game 4a');
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: game.id,
    });
    const logger = { log: jest.fn() };

    await normalizeAndDeleteGames(testApp.db, [game.id], logger);

    const [after] = await testApp.db.select().from(cb).where(eq(cb.id, b.id));
    expect(after).toBeDefined(); // binding survives the delete
    expect(after.gameId).toBeNull(); // FK SET NULL fired
    expect(after.bindingPurpose).toBe('general-lobby'); // normalized

    // The game row is gone and no 23514 was raised (no DB CHECK exists).
    const games = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, game.id));
    expect(games).toHaveLength(0);

    // A [binding-guard] line names the affected channel.
    const line = logger.log.mock.calls
      .map((c) => c[0] as string)
      .find((m) => typeof m === 'string' && m.includes('[binding-guard]'));
    expect(line).toBeDefined();
    expect(line).toContain(CHANNEL);

    const health = await getHealth();
    expect(health.data.find((d) => d.channelId === CHANNEL)).toBeUndefined();
  });

  // (4c) Collision: two co-channel monitors whose games are deleted together
  // cannot both become (general-lobby, NULL) under B2's nullgame unique index.
  // The normalizer keeps ONE (general-lobby) and drops the redundant one — no 23505.
  it('collision-aware: two monitors + one delete → one general-lobby survivor, no 23505', async () => {
    const gameA = await makeGame('Doomed Game 4c A');
    const gameB = await makeGame('Doomed Game 4c B');
    await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: gameA.id,
    });
    await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: gameB.id,
    });

    await expect(
      normalizeAndDeleteGames(testApp.db, [gameA.id, gameB.id]),
    ).resolves.not.toThrow();

    const rows = await bindingsOnChannel();
    expect(rows).toHaveLength(1); // one survivor, one dropped as redundant
    expect(rows[0].bindingPurpose).toBe('general-lobby');
    expect(rows[0].gameId).toBeNull();

    const health = await getHealth();
    expect(health.data.find((d) => d.channelId === CHANNEL)).toBeUndefined();
  });
});

describe('Binding health endpoint (Regression: ROK-1415)', () => {
  // (4b) Bypass path (raw SQL / pg_restore simulation): the delete nulls the
  // game_id WITHOUT the normalizer, leaving the binding inert. Health surfaces it.
  it('GET …/health flags a bypass-orphaned inert monitor binding', async () => {
    const game = await makeGame('Doomed Game 4b');
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: game.id,
    });

    // Simulate a raw SQL / restore path: delete the game with no normalization.
    await testApp.db.delete(schema.games).where(eq(schema.games.id, game.id));

    const [after] = await testApp.db.select().from(cb).where(eq(cb.id, b.id));
    expect(after.gameId).toBeNull();
    expect(after.bindingPurpose).toBe('game-voice-monitor'); // still inert

    const health = await getHealth();
    const flagged = health.data.find((d) => d.channelId === CHANNEL);
    expect(flagged).toBeDefined();
    expect(flagged?.code).toBe('BINDING_MONITOR_REQUIRES_GAME');
  });

  // (5) A guild with only healthy bindings reports nothing inert.
  it('GET …/health on a clean guild → { data: [] }', async () => {
    await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });

    const health = await getHealth();
    expect(health.data).toEqual([]);
  });
});
