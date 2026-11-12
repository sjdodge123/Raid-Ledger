/**
 * ROK-2185 item 2 — community and server (Pelican) hubs fill each upcoming
 * card's `memberSignupCount` from their own member set, through the real hub
 * adapters and DB. Fleet-only. Every case builds its own users + hub.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { insertCommunityHub } from './community/community-proposals.queries';
import { CommunityHubKindAdapter } from './community/community-hub-kind.adapter';
import { PelicanHubKindAdapter } from '../plugins/pelican/hub/pelican-hub-kind.adapter';

const HOUR = 3600 * 1000;
let testApp: TestApp;
let seq = 0;
const tag = (p: string): string => `${p}-${++seq}-${Date.now() % 100000}`;

async function mkUser(): Promise<number> {
  const n = ++seq;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        username: tag('hms'),
        discordId: `93${String(Date.now() % 1e9).padStart(9, '0')}${String(n).padStart(5, '0')}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  return user.id;
}

/** A hub with one upcoming event signed by `member` and `outsider`. */
async function seedHub(): Promise<{
  hubId: number;
  eventId: number;
  member: number;
}> {
  const [member, outsider] = [await mkUser(), await mkUser()];
  const hub = await insertCommunityHub(testApp.db, {
    gameId: testApp.seed.game.id,
    name: tag('MemberSignupHub'),
    blurb: 'Member signup hub',
    status: 'active',
    proposedBy: member,
    reviewedBy: null,
  });
  const start = new Date(Date.now() + 24 * HOUR);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: tag('hms-ev'),
        gameId: testApp.seed.game.id,
        creatorId: member,
        duration: [start, new Date(start.getTime() + 3 * HOUR)],
        guildId: hub.id,
      })
      .returning(),
    'event',
  );
  await testApp.db.insert(schema.eventSignups).values([
    { eventId: event.id, userId: member },
    { eventId: event.id, userId: outsider },
  ]);
  return { hubId: hub.id, eventId: event.id, member };
}

beforeAll(async () => {
  testApp = await getTestApp();
});

describe('hub upcoming cards — memberSignupCount (ROK-2185)', () => {
  it('a community hub counts its live members among the signups', async () => {
    const { hubId, eventId, member } = await seedHub();
    await testApp.db
      .insert(schema.hubCommunityMembers)
      .values({ guildId: hubId, userId: member, role: 'member' });
    const adapter = testApp.app.get(CommunityHubKindAdapter, { strict: false });
    const raids = await adapter.raids({ id: member, role: 'member' }, hubId);
    const card = raids.upcoming.find((c) => c.id === eventId);
    expect(card).toMatchObject({ signupCount: 2, memberSignupCount: 1 });
  });

  it('a server hub counts its current members among the signups', async () => {
    const { hubId, eventId, member } = await seedHub();
    await testApp.db.insert(schema.hubServerMembers).values({
      guildId: hubId,
      userId: member,
      source: 'manual',
      joinedAt: new Date(),
    });
    const adapter = testApp.app.get(PelicanHubKindAdapter, { strict: false });
    const raids = await adapter.raids({ id: member, role: 'member' }, hubId);
    const card = raids.upcoming.find((c) => c.id === eventId);
    expect(card).toMatchObject({ signupCount: 2, memberSignupCount: 1 });
  });
});
