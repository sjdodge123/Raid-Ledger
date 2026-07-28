/**
 * Channel Bindings — PATCH gameId + AC5 config-prune integration tests
 * (ROK-1416, B5-3). NEW FILE.
 *
 * WHY A NEW FILE: `channel-bindings.integration.spec.ts` is already 606 raw
 * lines; adding this describe would breach the 750-line cap for spec files, so
 * the B5-3 matrix lands here per the batch-plan escape hatch ("if the additions
 * would breach 750, put the new describe in a NEW file and say so").
 *
 * FAILS-BY-CONSTRUCTION: `UpdateChannelBindingSchema` has no `gameId` field yet,
 * so the controller strips it on parse and `updateConfig` never threads it — a
 * PATCH that should change / clear / conflict on the game currently no-ops and
 * returns 200 with the row untouched. AC5 config-prune does not exist, so the
 * merge keeps stale keys. Every case is RED until ROK-1416 is implemented.
 *
 * Drives the real controller over HTTP (real AdminGuard) with a stubbed bot
 * guild id — the same shape as `channel-bindings-invariant.integration.spec.ts`.
 * The POST classifier-rejection path is already covered there (case 1); this
 * file covers only the NEW gameId-PATCH + prune behaviour, no duplication.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from './discord-bot-client.service';

const GUILD = 'rok1416-guild';
const CHANNEL = 'rok1416-voice-channel';

let testApp: TestApp;
let token: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
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

/** Raw-insert a non-series voice binding on the shared test channel. */
async function insertBinding(o: {
  bindingPurpose: 'game-voice-monitor' | 'general-lobby';
  gameId: number | null;
  config?: Record<string, unknown>;
}): Promise<typeof cb.$inferSelect> {
  const [row] = await testApp.db
    .insert(cb)
    .values({
      guildId: GUILD,
      channelId: CHANNEL,
      channelType: 'voice',
      bindingPurpose: o.bindingPurpose,
      gameId: o.gameId,
      recurrenceGroupId: null,
      config: o.config ?? {},
    })
    .returning();
  return row;
}

/** A throwaway game distinct from the seeded one, for gameId reassignment. */
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

async function readBinding(id: string): Promise<typeof cb.$inferSelect> {
  const [row] = await testApp.db.select().from(cb).where(eq(cb.id, id));
  return row;
}

describe('Channel binding PATCH gameId (ROK-1416)', () => {
  it('PATCH { gameId } reassigns a monitor to the new game and persists it', async () => {
    const g2 = await makeGame('Reassign Target 1416');
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ gameId: g2.id });

    expect(res.status).toBe(200);
    expect((await readBinding(b.id)).gameId).toBe(g2.id);
  });

  it('PATCH { gameId: null } on a voice monitor → 400 and leaves the game intact', async () => {
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ gameId: null });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BINDING_MONITOR_REQUIRES_GAME');
    expect((await readBinding(b.id)).gameId).toBe(testApp.seed.game.id);
  });

  it('PATCH { gameId: <non-existent> } → 404 Game not found', async () => {
    const b = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ gameId: 987654321 });

    expect(res.status).toBe(404);
    expect((await readBinding(b.id)).gameId).toBe(testApp.seed.game.id);
  });

  it('PATCH { gameId } that duplicates a sibling monitor slot → 409', async () => {
    // Two monitors on one channel for different games is a permitted ROK-842
    // shape; reassigning the second onto the first game collides on the B2
    // non-series game unique index and must surface as a 409, not a silent no-op.
    const g2 = await makeGame('Sibling Monitor 1416');
    await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: testApp.seed.game.id,
    });
    const second = await insertBinding({
      bindingPurpose: 'game-voice-monitor',
      gameId: g2.id,
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${second.id}`)
      .set(auth())
      .send({ gameId: testApp.seed.game.id });

    expect(res.status).toBe(409);
  });
});

describe('Channel binding AC5 config prune (ROK-1416)', () => {
  it('drops allowJustChatting when a General Lobby is flipped to Activity Monitor', async () => {
    const b = await insertBinding({
      bindingPurpose: 'general-lobby',
      gameId: testApp.seed.game.id,
      config: {
        allowJustChatting: true,
        minPlayers: 3,
        autoClose: true,
        gracePeriod: 5,
      },
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${b.id}`)
      .set(auth())
      .send({ bindingPurpose: 'game-voice-monitor' });

    expect(res.status).toBe(200);
    const after = await readBinding(b.id);
    expect(after.bindingPurpose).toBe('game-voice-monitor');
    // allowJustChatting no longer applies to a monitor — it must be pruned, not
    // merge-preserved. Voice-monitor keys survive.
    expect(after.config).not.toHaveProperty('allowJustChatting');
    expect(after.config).toMatchObject({ minPlayers: 3 });
  });
});
