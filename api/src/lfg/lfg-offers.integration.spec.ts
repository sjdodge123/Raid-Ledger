/**
 * ROK-1451 AC7 — Quick Play sessions OFFER to clear a matching intent.
 *
 * The offer is fully derived (`GET /lfg/offers`): no column, no table, no
 * dismissal state. AC7c is the load-bearing one — a Quick Play session must
 * NEVER clear an intent on its own; only `DELETE /lfg/:gameId` does that.
 *
 * Split out of `lfg.integration.spec.ts` to stay inside the 750-line test-file
 * limit; the fixtures and request-wrapper patterns are the same.
 */
import type {
  LfgClearOfferDto,
  LfgGroupSummaryDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import {
  DAY_MS,
  createGame,
  createQuickPlayEvent,
  addQuickPlayParticipant,
  readIntent,
  type LfgIntentResponseDto,
} from './lfg.integration.spec-helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
});

function postIntent(token: string, gameId: number) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function getOffers(token: string) {
  return testApp.request
    .get('/lfg/offers')
    .set('Authorization', `Bearer ${token}`);
}

async function member(name: string) {
  return createMemberAndLogin(testApp, name, `${name}@test.local`);
}

describe('GET /lfg/offers', () => {
  it('offers to clear an intent after the caller played that game (AC7a)', async () => {
    const a = await member('alpha');
    const game = await createGame(testApp, 'Offer Game');
    const intent = (await postIntent(a.token, game.id))
      .body as LfgIntentResponseDto;

    const playedAt = new Date();
    const eventId = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
      playedAt,
    );
    await addQuickPlayParticipant(testApp, eventId, a.userId, playedAt);

    const res = await getOffers(a.token);
    expect(res.status).toBe(200);
    const offers = res.body as LfgClearOfferDto[];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      gameId: game.id,
      gameName: 'Offer Game',
      gameCoverUrl: null,
      intentId: intent.id,
      eventId,
    });
    expect(offers[0].playedAt).toEqual(expect.any(String));
  });

  it('produces NO offer for a session that started before the intent (AC7b)', async () => {
    const a = await member('alpha');
    const stale = await createGame(testApp, 'Played Before Game');
    const fresh = await createGame(testApp, 'Played After Game');

    // Session that pre-dates BOTH intents by two days.
    const before = new Date(Date.now() - 2 * DAY_MS);
    const staleEvent = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      stale.id,
      before,
    );
    await addQuickPlayParticipant(testApp, staleEvent, a.userId, before);

    await postIntent(a.token, stale.id);
    await postIntent(a.token, fresh.id);

    // Positive control on the same endpoint: a session AFTER the intent does
    // produce an offer, so the empty result above proves the time gate rather
    // than a broken query.
    const now = new Date();
    const freshEvent = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      fresh.id,
      now,
    );
    await addQuickPlayParticipant(testApp, freshEvent, a.userId, now);

    const offers = (await getOffers(a.token)).body as LfgClearOfferDto[];
    expect(offers.map((o) => o.gameId)).toEqual([fresh.id]);
  });

  it('never clears an intent on its own — only DELETE does (AC7c)', async () => {
    const a = await member('alpha');
    const game = await createGame(testApp, 'Inert Offer Game');
    await postIntent(a.token, game.id);
    const playedAt = new Date();
    const eventId = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
      playedAt,
    );
    await addQuickPlayParticipant(testApp, eventId, a.userId, playedAt);

    // Reading the offer must not mutate anything, however many times.
    expect((await getOffers(a.token)).body as LfgClearOfferDto[]).toHaveLength(
      1,
    );
    expect((await getOffers(a.token)).body as LfgClearOfferDto[]).toHaveLength(
      1,
    );

    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'active',
    );
    const groups = (
      await testApp.request
        .get('/lfg')
        .set('Authorization', `Bearer ${a.token}`)
    ).body as LfgGroupSummaryDto[];
    expect(groups.map((g) => g.gameId)).toEqual([game.id]);

    // The player acting on the offer is what clears it.
    const del = await testApp.request
      .delete(`/lfg/${game.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(del.status).toBe(204);
    expect((await readIntent(testApp, a.userId, game.id))!.status).toBe(
      'cleared',
    );
    expect((await getOffers(a.token)).body).toEqual([]);
  });

  it('ignores sessions the caller did not take part in', async () => {
    const a = await member('alpha');
    const b = await member('bravo');
    const game = await createGame(testApp, 'Someone Else Game');
    await postIntent(a.token, game.id);

    const playedAt = new Date();
    const eventId = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
      playedAt,
    );
    await addQuickPlayParticipant(testApp, eventId, b.userId, playedAt);

    expect((await getOffers(a.token)).body).toEqual([]);
  });

  it('ignores scheduled (non ad-hoc) events', async () => {
    const a = await member('alpha');
    const game = await createGame(testApp, 'Scheduled Game');
    await postIntent(a.token, game.id);

    const playedAt = new Date();
    const eventId = await createQuickPlayEvent(
      testApp,
      testApp.seed.adminUser.id,
      game.id,
      playedAt,
      { isAdHoc: false, adHocStatus: null },
    );
    await addQuickPlayParticipant(testApp, eventId, a.userId, playedAt);

    expect((await getOffers(a.token)).body).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await testApp.request.get('/lfg/offers')).status).toBe(401);
  });
});
