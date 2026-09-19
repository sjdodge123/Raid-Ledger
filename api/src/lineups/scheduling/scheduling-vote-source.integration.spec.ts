/**
 * ROK-1550 — POST /lineups/:lineupId/schedule/:matchId/vote records WHERE the
 * vote came from.
 *
 * The audit (docs/spikes/rok-1540-scheduling-poll-audit.md, F-17) could not
 * measure the Discord-vs-web split at all: prod reads "100% web" only because
 * nothing else was ever recordable. `community_lineup_schedule_votes.source`
 * is what makes the phase-4 keep-or-drop decision on the Discord poll card
 * evidence-based, so these tests pin the column's honesty end to end:
 *
 *   - an omitted `source` (every pre-ROK-1550 client) persists as `'web'` —
 *     not null, not rejected;
 *   - `'discord'` persists verbatim;
 *   - a stance flip OVERWRITES the source, so the row names the action behind
 *     its CURRENT answer rather than the one that happened to create it;
 *   - an unknown value is a 400 with NO row written — a typo in a link must
 *     surface, never silently land as 'web' and pollute the measurement;
 *   - the 200 body is byte-for-byte what ROK-1617 returned.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

describe('Schedule vote provenance (integration)', () => {
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

  /** A schedulable public poll with one future slot, owned by the admin. */
  async function seedPoll(): Promise<{
    lineupId: number;
    matchId: number;
    slotId: number;
  }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Vote Source Poll',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
        visibility: 'public',
        publicSlug: generatePublicSlug(),
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: match.id,
        proposedTime: new Date('2099-04-01T19:00:00.000Z'),
        suggestedBy: 'system',
      })
      .returning();
    return { lineupId: lineup.id, matchId: match.id, slotId: slot.id };
  }

  /** Post a vote, omitting each optional field the caller leaves undefined. */
  function postVote(
    poll: { lineupId: number; matchId: number; slotId: number },
    body: { stance?: string; source?: string } = {},
  ) {
    return testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slotId: poll.slotId, ...body });
  }

  /** The admin's vote rows on a slot. */
  async function voteRows(slotId: number) {
    return testApp.db
      .select()
      .from(schema.communityLineupScheduleVotes)
      .where(eq(schema.communityLineupScheduleVotes.slotId, slotId));
  }

  /** Suggest a time, omitting `source` when the caller leaves it undefined. */
  function postSuggest(
    poll: { lineupId: number; matchId: number },
    proposedTime: string,
    source?: string,
  ) {
    return testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/suggest`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(source === undefined ? { proposedTime } : { proposedTime, source });
  }

  /** Every slot on a match, oldest first. */
  async function slotRows(matchId: number) {
    return testApp.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  }

  it("records an omitted source as 'web'", async () => {
    const poll = await seedPoll();

    // Exactly the body a pre-ROK-1550 client posts: no `source` key at all.
    const res = await postVote(poll);

    expect(res.status).toBe(200);
    // The ROK-1617 response shape is untouched by this story.
    expect(res.body).toEqual({ voted: true, stance: 'yes' });
    const rows = await voteRows(poll.slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('web');
  });

  it("records source='discord' when the voter arrived from the card", async () => {
    const poll = await seedPoll();

    const res = await postVote(poll, { source: 'discord' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: true, stance: 'yes' });
    const rows = await voteRows(poll.slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('discord');
    expect(rows[0].stance).toBe('yes');
  });

  it('a stance flip overwrites the source with the flip’s own', async () => {
    const poll = await seedPoll();
    await postVote(poll, { source: 'discord' });

    // Same member, opposite stance, different surface: an UPDATE, not a row.
    const res = await postVote(poll, { stance: 'no', source: 'web' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ voted: false, stance: 'no' });
    const rows = await voteRows(poll.slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stance).toBe('no');
    // Keeping 'discord' here would credit the card for an answer the web gave.
    expect(rows[0].source).toBe('web');
  });

  it('a discord flip of a web vote is attributed to discord', async () => {
    const poll = await seedPoll();
    await postVote(poll);

    const res = await postVote(poll, { stance: 'no', source: 'discord' });

    expect(res.status).toBe(200);
    const rows = await voteRows(poll.slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('discord');
  });

  it('rejects an unknown source with 400 and writes no row', async () => {
    const poll = await seedPoll();

    const res = await postVote(poll, { source: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body.message).toHaveProperty('source');
    // The whole point: a bad value must NOT be silently stored as 'web'.
    expect(await voteRows(poll.slotId)).toHaveLength(0);
  });

  it('rejects a mis-cased source rather than normalising it', async () => {
    const poll = await seedPoll();

    const res = await postVote(poll, { source: 'Discord' });

    expect(res.status).toBe(400);
    expect(await voteRows(poll.slotId)).toHaveLength(0);
  });

  /**
   * Review fix (ROK-1550): "Find a better time" auto-votes for the slot it
   * creates. That auto-vote used the insert helper's `'web'` default, so a
   * suggestion made off the Discord card was measured as a web vote.
   */
  describe('a suggestion auto-votes with its own source', () => {
    const SUGGESTED = '2099-05-01T20:00:00.000Z';

    it("stamps the auto-vote 'discord' when the suggestion came from the card", async () => {
      const poll = await seedPoll();

      const res = await postSuggest(poll, SUGGESTED, 'discord');

      expect(res.status).toBe(201);
      const rows = await voteRows((res.body as { id: number }).id);
      expect(rows).toHaveLength(1);
      expect(rows[0].stance).toBe('yes');
      expect(rows[0].source).toBe('discord');
    });

    it("stamps the auto-vote 'web' when no source is sent", async () => {
      const poll = await seedPoll();

      // Exactly the body a pre-fix client posts: no `source` key at all.
      const res = await postSuggest(poll, SUGGESTED);

      expect(res.status).toBe(201);
      const rows = await voteRows((res.body as { id: number }).id);
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe('web');
    });

    it('rejects an unknown source with 400, creating neither slot nor vote', async () => {
      const poll = await seedPoll();

      const res = await postSuggest(poll, SUGGESTED, 'bogus');

      expect(res.status).toBe(400);
      expect(res.body.message).toHaveProperty('source');
      // Only the seeded slot survives, and it carries no vote.
      const slots = await slotRows(poll.matchId);
      expect(slots).toHaveLength(1);
      expect(slots[0].id).toBe(poll.slotId);
      expect(await voteRows(poll.slotId)).toHaveLength(0);
    });
  });
});
