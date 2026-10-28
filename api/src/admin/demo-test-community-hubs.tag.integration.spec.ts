/**
 * ROK-2030 — `POST /admin/test/community-hubs/seed` with a `tag`: two tags
 * seeded on ONE game coexist, a re-seed of tag A leaves tag B's hubs (and its
 * hub event) intact, and an untagged seed neither clears nor collides with
 * tagged hubs. Real Postgres via the HTTP layer.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

interface SeedBody {
  hubIds: Record<'crew' | 'solo' | 'archived' | 'server' | 'guild', number>;
  hubNames: Record<string, string>;
  proposalId: number;
  hubEvent?: { id: number };
}

const ALL = ['crew', 'solo', 'archived', 'server', 'guild'] as const;

describe('community-hubs seed tag scoping (ROK-2030)', () => {
  let testApp: TestApp;
  let adminToken: string;
  const originalDemoEnv = process.env.DEMO_MODE;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    process.env.DEMO_MODE = originalDemoEnv;
  });

  async function seed(body: Record<string, unknown>): Promise<SeedBody> {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    const res = await testApp.request
      .post('/admin/test/community-hubs/seed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id, ...body });
    expect({ status: res.status, body: res.body as unknown }).toEqual(
      expect.objectContaining({ status: 200 }),
    );
    return res.body as SeedBody;
  }

  async function hubExists(id: number): Promise<boolean> {
    const rows = await testApp.db
      .select({ id: schema.guilds.id })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, id));
    return rows.length === 1;
  }

  async function survivors(body: SeedBody): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const k of ALL) out[k] = await hubExists(body.hubIds[k]);
    out.proposal = await hubExists(body.proposalId);
    return out;
  }

  const kept = {
    crew: true,
    solo: true,
    archived: true,
    server: true,
    guild: true,
    proposal: true,
  };

  it("re-seeding tag A leaves tag B's hubs and hub event intact", async () => {
    const b = await seed({ tag: 'spec-b-desktop-w00', withEvent: true });
    const a1 = await seed({ tag: 'spec-a-desktop-w00' });
    const a2 = await seed({ tag: 'spec-a-desktop-w00' });
    expect(b.hubNames.crew).toBe('Seed Crew #spec-b-desktop-w00');
    expect(await survivors(b)).toEqual(kept);
    expect(await hubExists(a1.hubIds.crew)).toBe(false);
    expect(await survivors(a2)).toEqual(kept);
    const eventId = b.hubEvent?.id ?? -1;
    const ev = await testApp.db
      .select({ guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(ev).toEqual([{ guildId: b.hubIds.crew }]);
  });

  it('an untagged seed keeps tagged hubs and still resets itself', async () => {
    const tagged = await seed({ tag: 'spec-c-mobile-w01' });
    const plain1 = await seed({});
    const plain2 = await seed({});
    expect(plain2.hubNames.crew).toBe('Seed Crew');
    expect(await hubExists(plain1.hubIds.crew)).toBe(false);
    expect(await survivors(tagged)).toEqual(kept);
  });

  it('rejects a tag outside [a-z0-9-]{1,32}', async () => {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    const res = await testApp.request
      .post('/admin/test/community-hubs/seed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tag: 'Bad_Tag%' });
    expect(res.status).toBe(400);
  });
});
