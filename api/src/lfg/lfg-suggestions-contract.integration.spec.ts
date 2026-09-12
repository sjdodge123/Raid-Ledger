/**
 * ROK-1535 — the suggestions wire body against the WEB's own schema.
 *
 * `useLfgSuggestions` → `getLfgSuggestions` → `fetchApi(..., LfgSuggestionsResponseSchema)`.
 * A body that schema rejects makes `fetchApi` throw, the query error, `data`
 * undefined — and, before this story's panel fix, the group page said "Nobody
 * else to suggest right now". So a contract drift on REAL data is
 * indistinguishable from an empty community, which is exactly how the PEAK
 * report survived three passes.
 *
 * `lfg-reads.integration.spec.ts` already parses a body, but only a one-row,
 * hearted-only, `lastPlayedAt: null`, `inviteState: 'none'` shape. This spec
 * parses the API's ACTUAL serialization of every field variant the service can
 * emit: all three reasons, a real `lastPlayedAt` AND a null one, and BOTH
 * invite states (one recipient invited inside the no-repeat horizon).
 *
 * The schema is imported from `@raid-ledger/contract` — the same symbol the
 * web passes to `fetchApi`, never a local re-declaration, or the test could
 * pass against a shape the browser rejects.
 *
 * Run with `TZ=UTC` (see the sibling spec's note on naive timestamp columns).
 */
import {
  LfgSuggestionReasonSchema,
  LfgSuggestionsResponseSchema,
  LfgInviteStateSchema,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createPastEvent,
  signupViaDb,
} from '../events/signups.integration.spec-helpers';
import { createGame, heartGame } from './lfg.integration.spec-helpers';
import {
  createPlainUser,
  markAttended,
  HOUR_MS,
} from './lfg-reads.integration.spec-helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** A past event for the game the user was marked `attended` on. */
async function attendedEvent(gameId: number, userId: number): Promise<void> {
  const end = new Date(Date.now() - 72 * HOUR_MS);
  const eventId = await createPastEvent(testApp, userId, {
    gameId,
    title: 'Past 72h',
    duration: [new Date(end.getTime() - 3 * HOUR_MS), end] as [Date, Date],
  });
  await signupViaDb(testApp, eventId, userId);
  await markAttended(testApp, eventId, userId);
}

/** A live invite inside the no-repeat horizon — the `sent` state's only source. */
async function inviteSentNow(
  gameId: number,
  inviterUserId: number,
  recipientUserId: number,
): Promise<void> {
  await testApp.db
    .insert(schema.lfgInvites)
    .values({ gameId, inviterUserId, recipientUserId });
}

describe('GET /lfg/:gameId/suggestions — the web contract on real rows', () => {
  /**
   * The PEAK mirror, widened so every DTO field carries a REAL value: four
   * Steam owners (one of whom also attended, so `played` + `owns` and a real
   * `lastPlayedAt`), one hearter, and one owner already invited so the body
   * carries `inviteState: 'sent'` as well as `'none'`.
   */
  it('answers with a body the web schema parses, on every field variant', async () => {
    const game = await createGame(testApp, 'PEAK Contract');
    const caller = await createMemberAndLogin(
      testApp,
      'contract-caller',
      'contract-caller@test.local',
    );
    await testApp.request
      .post('/lfg')
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ gameId: game.id });

    const owners: number[] = [];
    for (const name of ['c-owner-a', 'c-owner-b', 'c-owner-c', 'c-owner-d']) {
      const owner = await createPlainUser(testApp, name);
      await heartGame(testApp, owner, game.id, 'steam_library');
      owners.push(owner);
    }
    const hearter = await createPlainUser(testApp, 'c-hearter');
    await heartGame(testApp, hearter, game.id, 'manual');
    // One owner also played it: `played` + `owns`, with a real instant.
    await attendedEvent(game.id, owners[0]);
    // One owner already invited: the only way to observe `sent` on the wire.
    await inviteSentNow(game.id, caller.userId, owners[1]);

    const res = await testApp.request
      .get(`/lfg/${game.id}/suggestions`)
      .set('Authorization', `Bearer ${caller.token}`);
    expect(res.status).toBe(200);

    // The assertion: the browser's own parse, on the API's own serialization.
    const parsed = LfgSuggestionsResponseSchema.parse(res.body);

    expect(parsed.suggestions).toHaveLength(5);
    const byUser = new Map(parsed.suggestions.map((s) => [s.userId, s]));
    // Every variant the service can emit is actually present in this body,
    // so a green parse is not green by omission.
    expect(byUser.get(owners[0])!.reasons).toEqual(['played', 'owns']);
    expect(byUser.get(owners[0])!.lastPlayedAt).toEqual(expect.any(String));
    expect(byUser.get(owners[1])!.inviteState).toBe('sent');
    expect(byUser.get(owners[2])!.inviteState).toBe('none');
    expect(byUser.get(owners[2])!.lastPlayedAt).toBeNull();
    expect(byUser.get(hearter)!.reasons).toEqual(['hearted']);
    expect(byUser.get(caller.userId)).toBeUndefined();
  });

  /**
   * The enums the API is free to emit must all be accepted. A schema narrowed
   * to the values the fixtures happen to produce would reject a real response
   * the moment a rarer one turns up.
   */
  it('accepts every reason and invite state the API can emit', () => {
    for (const reason of ['played', 'owns', 'hearted']) {
      expect(LfgSuggestionReasonSchema.parse(reason)).toBe(reason);
    }
    for (const state of ['none', 'sent']) {
      expect(LfgInviteStateSchema.parse(state)).toBe(state);
    }
    const row = {
      userId: 1,
      username: 'u',
      displayName: null,
      avatarUrl: null,
      reasons: ['played', 'owns', 'hearted'],
      lastPlayedAt: null,
      inviteState: 'none',
    };
    expect(
      LfgSuggestionsResponseSchema.parse({ gameId: 1, suggestions: [row] })
        .suggestions[0].lastPlayedAt,
    ).toBeNull();
  });
});
