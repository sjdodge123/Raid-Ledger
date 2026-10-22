/**
 * ROK-1893 P4 (spec §10.6 H1–H5, rulings R22/R28) — an event's `hub` ref on
 * the calendar payloads, against a real DB. A tagged event carries
 * `hub {id,name,kind}` only while its hub is visible (`status = 'active'`,
 * not hidden); otherwise `hub: null` while `guildId` stays set. Untagged and
 * hub-deleted events (`guild_id` SET NULL) map to `hub: null`.
 */
import { eq } from 'drizzle-orm';
import type { EventResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { EventsService } from './events.service';

let testApp: TestApp;
let adminToken: string;
const HOUR = 3600_000;
const START = Date.now() + 24 * HOUR;

type HubStatus = 'proposed' | 'active' | 'archived';

async function seedHub(
  name: string,
  status: HubStatus = 'active',
  hidden = false,
): Promise<number> {
  const archived = status === 'archived';
  const [hub] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status,
        hiddenAt: hidden ? new Date() : null,
        archivedAt: archived ? new Date() : null,
        archivedReason: archived ? 'admin' : null,
        proposedBy: status === 'proposed' ? testApp.seed.adminUser.id : null,
      })
      .returning(),
    `hub ${name}`,
  );
  return hub.id;
}

async function seedEvent(title: string, guildId: number | null) {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        guildId,
        duration: [new Date(START), new Date(START + HOUR)],
      })
      .returning(),
    `event ${title}`,
  );
  return event.id;
}

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

async function getOne(id: number): Promise<EventResponseDto> {
  const res = await testApp.request.get(`/events/${id}`).set(auth());
  expect(res.status).toBe(200);
  return res.body as EventResponseDto;
}

async function listById(): Promise<Map<number, EventResponseDto>> {
  const res = await testApp.request
    .get('/events')
    .query({
      startAfter: new Date(START - HOUR).toISOString(),
      endBefore: new Date(START + 2 * HOUR).toISOString(),
      limit: 100,
    })
    .set(auth());
  expect(res.status).toBe(200);
  const rows = (res.body as { data: EventResponseDto[] }).data;
  return new Map(rows.map((e) => [e.id, e]));
}

async function byIds(ids: number[]): Promise<Map<number, EventResponseDto>> {
  const rows = await testApp.app.get(EventsService).findByIds(ids);
  return new Map(rows.map((e) => [e.id, e]));
}

/** Every path's row keeps `guildId` but carries no hub ref (R28). */
function expectNullHubEverywhere(
  rows: (EventResponseDto | undefined)[],
  hubId: number,
): void {
  for (const e of rows) {
    const row = defined(e, `event for hub ${hubId}`);
    expect({ hub: row.hub, guildId: row.guildId }).toEqual({
      hub: null,
      guildId: hubId,
    });
  }
}

describe('Event hub ref (ROK-1893 P4)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  it('H1/H4: a visible tagged hub maps to {id,name,kind} on list, detail and by-ids', async () => {
    const hubId = await seedHub('BG3 Friends');
    const eventId = await seedEvent('Tagged raid', hubId);
    const want = { id: hubId, name: 'BG3 Friends', kind: 'game_community' };

    const listed = defined((await listById()).get(eventId), 'listed event');
    expect(listed.hub).toEqual(want);
    expect(listed.guildId).toBe(hubId);
    expect((await getOne(eventId)).hub).toEqual(want);
    const found = defined((await byIds([eventId])).get(eventId), 'by-ids');
    expect(found.hub).toEqual(want);
  });

  it('H2: an untagged event has hub null on every path', async () => {
    const eventId = await seedEvent('Untagged raid', null);

    const listed = defined((await listById()).get(eventId), 'listed event');
    expect(listed.hub).toBeNull();
    expect((await getOne(eventId)).hub).toBeNull();
    expect((await byIds([eventId])).get(eventId)?.hub).toBeNull();
  });

  it('H3/R28: hidden, proposed and archived hubs map to null but keep guildId', async () => {
    const hidden = await seedHub('Hidden Hub', 'active', true);
    const proposed = await seedHub('Proposed Hub', 'proposed');
    const archived = await seedHub('Archived Hub', 'archived');
    const ids = {
      [hidden]: await seedEvent('Hidden hub raid', hidden),
      [proposed]: await seedEvent('Proposed hub raid', proposed),
      [archived]: await seedEvent('Archived hub raid', archived),
    };

    const listed = await listById();
    const found = await byIds(Object.values(ids));
    for (const [hubId, eventId] of Object.entries(ids)) {
      const all = [
        listed.get(eventId),
        found.get(eventId),
        await getOne(eventId),
      ];
      expectNullHubEverywhere(all, Number(hubId));
    }
  });

  it('H5: a deleted hub sets guild_id null and the event maps to hub null', async () => {
    const hubId = await seedHub('Doomed Hub');
    const eventId = await seedEvent('Orphaned raid', hubId);
    await testApp.db.delete(schema.guilds).where(eq(schema.guilds.id, hubId));

    const detail = await getOne(eventId);
    expect({ hub: detail.hub, guildId: detail.guildId }).toEqual({
      hub: null,
      guildId: null,
    });
    const listed = defined((await listById()).get(eventId), 'listed event');
    expect(listed.hub).toBeNull();
  });
});
