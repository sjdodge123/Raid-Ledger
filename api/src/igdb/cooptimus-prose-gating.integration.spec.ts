/**
 * Co-Optimus prose gating integration tests (ROK-1398, AC4).
 *
 * TDD — written BEFORE the server-side strip exists.
 *
 * The Co-Optimus grant covers the co-op *facts*; the editorial prose
 * ("The Co-Op Experience" blurb and their game description) is only rendered
 * once the operator explicitly opts in. Gating is SERVER-SIDE so the unlicensed
 * prose never leaves the API: when `cooptimusProseEnabled` is false (the
 * default), `GET /games/:id` must omit `coopExperience` and `description` from
 * `cooptimusExtras` while every other extras key still ships.
 *
 * Contract the implementation must satisfy:
 *   - SettingsService gains `getCooptimusProseEnabled()` / `setCooptimusProseEnabled(v)`
 *   - the getter resolves `false` when the setting has never been written
 *
 * The Co-Optimus HTTP user-agent is deliberately never referenced here.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import * as schema from '../drizzle/schema';

/**
 * SettingsService surface this story adds. Typed structurally (rather than by
 * editing the service) so this spec compiles today and fails at RUN time with a
 * clear "is not a function" until the setting is implemented.
 */
type ProseSettings = {
  getCooptimusProseEnabled(): Promise<boolean>;
  setCooptimusProseEnabled(value: boolean): Promise<unknown>;
};

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function settings(): ProseSettings {
  const service: unknown = testApp.app.get(SettingsService);
  return service as ProseSettings;
}

const EXTRAS = {
  system: 'PC',
  steamAppId: 548430,
  featurelist: 'Online Co-Op,Downloadable Only',
  coopExperience: 'Four dwarves dig, shoot, and lose the drop pod together.',
  description: 'A co-op first-person shooter about dwarves mining in space.',
  downloadableOnly: true,
};

/** Insert an enriched Co-Optimus game and return its id. */
async function insertEnrichedGame(
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<number> {
  const slug = `coop-prose-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name: 'Deep Rock Galactic',
      slug,
      cooptimusId: 4471,
      cooptimusOnlineMax: 4,
      cooptimusCouchMax: 2,
      cooptimusLanMax: 4,
      cooptimusSplitscreen: true,
      cooptimusDropIn: true,
      cooptimusCampaignCoop: true,
      cooptimusComboCoop: true,
      cooptimusUrl: 'https://www.co-optimus.com/game/4471/pc/example.html',
      cooptimusExtras: EXTRAS,
      cooptimusSyncedAt: new Date(),
      ...overrides,
    })
    .returning();
  return game.id;
}

type ExtrasBody = {
  cooptimusExtras: Record<string, unknown> | null;
  cooptimusOnlineMax: number | null;
  cooptimusUrl: string | null;
};

async function fetchDetail(id: number): Promise<ExtrasBody> {
  const res = await testApp.request.get(`/games/${id}`);
  expect(res.status).toBe(200);
  return res.body as ExtrasBody;
}

describe('Co-Optimus prose gating (ROK-1398 AC4)', () => {
  it('defaults the prose flag to false when it has never been set', async () => {
    await expect(settings().getCooptimusProseEnabled()).resolves.toBe(false);
  });

  it('omits coopExperience and description from the detail response by default', async () => {
    const id = await insertEnrichedGame();

    const body = await fetchDetail(id);

    expect(body.cooptimusExtras).not.toBeNull();
    const extras = body.cooptimusExtras as Record<string, unknown>;
    expect(extras.coopExperience ?? null).toBeNull();
    expect(extras.description ?? null).toBeNull();
  });

  it('strips only the prose — every other extras key and fact still ships', async () => {
    const id = await insertEnrichedGame();

    const body = await fetchDetail(id);
    const extras = body.cooptimusExtras as Record<string, unknown>;

    // The strip must be surgical: prose out ...
    expect(extras.coopExperience ?? null).toBeNull();
    expect(extras.description ?? null).toBeNull();
    // ... everything the grant does cover stays in.
    expect(extras.system).toBe('PC');
    expect(extras.downloadableOnly).toBe(true);
    expect(extras.featurelist).toBe('Online Co-Op,Downloadable Only');
    expect(body.cooptimusOnlineMax).toBe(4);
    expect(body.cooptimusUrl).toBe(
      'https://www.co-optimus.com/game/4471/pc/example.html',
    );
  });

  it('returns both prose fields once the operator enables prose', async () => {
    const id = await insertEnrichedGame();
    await settings().setCooptimusProseEnabled(true);

    const body = await fetchDetail(id);
    const extras = body.cooptimusExtras as Record<string, unknown>;

    expect(extras.coopExperience).toBe(EXTRAS.coopExperience);
    expect(extras.description).toBe(EXTRAS.description);
  });

  it('strips prose again after the operator disables the flag', async () => {
    const id = await insertEnrichedGame();
    await settings().setCooptimusProseEnabled(true);
    await settings().setCooptimusProseEnabled(false);

    const body = await fetchDetail(id);
    const extras = body.cooptimusExtras as Record<string, unknown>;

    expect(extras.coopExperience ?? null).toBeNull();
    expect(extras.description ?? null).toBeNull();
    expect(extras.system).toBe('PC');
  });

  it('leaves a null extras blob null instead of substituting an empty object', async () => {
    const withExtras = await insertEnrichedGame();
    const withoutExtras = await insertEnrichedGame({ cooptimusExtras: null });

    // Control: the strip really is active on the row that has extras ...
    const stripped = await fetchDetail(withExtras);
    const extras = stripped.cooptimusExtras as Record<string, unknown>;
    expect(extras.coopExperience ?? null).toBeNull();

    // ... and the null-extras row is passed through untouched.
    const body = await fetchDetail(withoutExtras);
    expect(body.cooptimusExtras).toBeNull();
    expect(body.cooptimusOnlineMax).toBe(4);
  });
});
