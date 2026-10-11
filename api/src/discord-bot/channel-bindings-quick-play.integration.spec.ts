/**
 * ROK-1766 lane B — Quick Play Announcements binding layer (real DB, real
 * controller over HTTP with a stubbed bot guild id; same shape as
 * channel-bindings-purpose-game.integration.spec.ts).
 *
 * Covers: the findExistingBinding TRAP (a QP bind must NOT overwrite an
 * Announcements row for the same game on the same channel), the one-per-game
 * 409 on create AND on a PATCH flip, the QP-requires-game 400, the ROK-1419
 * widening left intact for the original purposes, the oldest-row read, and the
 * game-delete normalizer dropping (not retargeting) a QP row.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import { DiscordBotClientService } from './discord-bot-client.service';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { normalizeAndDeleteGames } from './services/channel-bindings-invariant.helpers';

const GUILD = 'rok1766-guild';
const CH_A = 'rok1766-text-a';
const CH_B = 'rok1766-text-b';
const VOICE = 'rok1766-voice';
const QP = 'quick-play-announcements';

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
const gameId = () => testApp.seed.game.id;

/** Raw-insert a non-series binding. */
async function insertBinding(o: {
  channelId: string;
  channelType?: 'text' | 'voice';
  bindingPurpose: string;
  gameId: number | null;
  createdAt?: Date;
}): Promise<typeof cb.$inferSelect> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(cb)
      .values({
        guildId: GUILD,
        channelId: o.channelId,
        channelType: o.channelType ?? 'text',
        bindingPurpose: o.bindingPurpose,
        gameId: o.gameId,
        recurrenceGroupId: null,
        config: {},
        ...(o.createdAt && { createdAt: o.createdAt }),
      })
      .returning(),
    'binding',
  );
  return row;
}

const rowsOn = (channelId: string) =>
  testApp.db.select().from(cb).where(eq(cb.channelId, channelId));

const postBinding = (body: Record<string, unknown>) =>
  testApp.request.post('/admin/discord/bindings').set(auth()).send(body);

describe('Quick Play Announcements — create (ROK-1766)', () => {
  it('QP(G) on a channel holding Announcements(G) keeps BOTH rows (the trap)', async () => {
    const ann = await insertBinding({
      channelId: CH_A,
      bindingPurpose: 'game-announcements',
      gameId: gameId(),
    });

    const res = await postBinding({
      channelId: CH_A,
      channelType: 'text',
      bindingPurpose: QP,
      gameId: gameId(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(ann.id);
    const purposes = (await rowsOn(CH_A)).map((r) => r.bindingPurpose).sort();
    expect(purposes).toEqual(['game-announcements', QP]);
  });

  it('a second QP for the same game on another channel → 409 BINDING_QP_GAME_TAKEN', async () => {
    await insertBinding({
      channelId: CH_A,
      bindingPurpose: QP,
      gameId: gameId(),
    });

    const res = await postBinding({
      channelId: CH_B,
      channelType: 'text',
      bindingPurpose: QP,
      gameId: gameId(),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BINDING_QP_GAME_TAKEN');
    expect(res.body.field).toBe('gameId');
    expect(await rowsOn(CH_B)).toHaveLength(0);
  });

  it('PATCH flipping Announcements(G) to QP while another channel holds QP(G) → 409', async () => {
    await insertBinding({
      channelId: CH_A,
      bindingPurpose: QP,
      gameId: gameId(),
    });
    const ann = await insertBinding({
      channelId: CH_B,
      bindingPurpose: 'game-announcements',
      gameId: gameId(),
    });

    const res = await testApp.request
      .patch(`/admin/discord/bindings/${ann.id}`)
      .set(auth())
      .send({ bindingPurpose: QP });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BINDING_QP_GAME_TAKEN');
    const [after] = nonEmpty(await rowsOn(CH_B), 'ann read-back');
    expect(after.bindingPurpose).toBe('game-announcements');
  });

  it('QP without a game → 400 BINDING_QP_REQUIRES_GAME and no row', async () => {
    const res = await postBinding({
      channelId: CH_A,
      channelType: 'text',
      bindingPurpose: QP,
      gameId: null,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BINDING_QP_REQUIRES_GAME');
    expect(await rowsOn(CH_A)).toHaveLength(0);
  });
});

describe('Quick Play Announcements — original purposes unchanged (ROK-1766 D4)', () => {
  it('re-upserting Announcements(G) updates that row and never touches QP(G)', async () => {
    const ann = await insertBinding({
      channelId: CH_A,
      bindingPurpose: 'game-announcements',
      gameId: gameId(),
    });
    const qp = await insertBinding({
      channelId: CH_A,
      bindingPurpose: QP,
      gameId: gameId(),
    });

    const res = await postBinding({
      channelId: CH_A,
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: gameId(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(ann.id);
    const after = await rowsOn(CH_A);
    expect(after).toHaveLength(2);
    const qpAfter = after.find((r) => r.id === qp.id);
    expect(qpAfter?.bindingPurpose).toBe(QP);
    expect(qpAfter?.updatedAt.getTime()).toBe(qp.updatedAt.getTime());
  });

  it('keeps the ROK-1419 widening: lobby(G) re-posted as monitor(G) updates the same row', async () => {
    const lobby = await insertBinding({
      channelId: VOICE,
      channelType: 'voice',
      bindingPurpose: 'general-lobby',
      gameId: gameId(),
    });

    const res = await postBinding({
      channelId: VOICE,
      channelType: 'voice',
      bindingPurpose: 'game-voice-monitor',
      gameId: gameId(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(lobby.id);
    const rows = await rowsOn(VOICE);
    expect(rows.map((r) => r.bindingPurpose)).toEqual(['game-voice-monitor']);
  });
});

describe('Quick Play Announcements — lookup + game delete (ROK-1766)', () => {
  it('getQuickPlayChannelForGame returns the OLDEST QP row, null for another game', async () => {
    // Pre-guard rows (D3 has no DB index): insert the newer one first so a
    // natural-order read would pick it.
    await insertBinding({
      channelId: CH_A,
      bindingPurpose: QP,
      gameId: gameId(),
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    await insertBinding({
      channelId: CH_B,
      bindingPurpose: QP,
      gameId: gameId(),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const svc = testApp.app.get(ChannelBindingsService);

    expect(await svc.getQuickPlayChannelForGame(GUILD, gameId())).toBe(CH_B);
    expect(
      await svc.getQuickPlayChannelForGame(GUILD, gameId() + 9999),
    ).toBeNull();
  });

  it('deleting the game drops a QP row instead of retargeting it', async () => {
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name: 'QP Delete 1766',
          slug: 'qp-delete-1766',
          igdbId: null,
        })
        .returning(),
      'game',
    );
    const qp = await insertBinding({
      channelId: CH_A,
      bindingPurpose: QP,
      gameId: g.id,
    });

    await normalizeAndDeleteGames(testApp.db, [g.id]);

    const left = await testApp.db.select().from(cb).where(eq(cb.id, qp.id));
    expect(left).toEqual([]);
  });
});
