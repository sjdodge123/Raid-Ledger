/**
 * Integration test for the `weeklyGenerate` composition (ROK-1127 A6).
 *
 * `runGenerateSuggestions` and `runExpireSuggestions` each have their own
 * pipeline specs; this covers the service-level pass that runs BOTH against
 * the same database in one call, and the `bypassQuota` flag that separates
 * the cron path from the admin-triggered path.
 */
import { eq } from 'drizzle-orm';
import type { LlmCategoryProposalDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import type { LlmService } from '../ai/llm.service';
import type { SettingsService } from '../settings/settings.service';
import type { CronJobService } from '../cron-jobs/cron-job.service';
import { DiscoveryCategoriesService } from './discovery-categories.service';

const PROPOSAL: LlmCategoryProposalDto = {
  name: 'Weekly Co-op',
  description: 'Fresh co-op picks for the week.',
  category_type: 'community_pattern',
  theme_vector: {
    co_op: 0.9,
    pvp: -0.1,
    rpg: 0,
    survival: 0.2,
    strategy: 0,
    social: 0.6,
    mmo: 0,
  },
  filter_criteria: {},
  population_strategy: 'vector',
  expires_at: '2026-12-01T00:00:00Z',
};

describe('DiscoveryCategoriesService.weeklyGenerate (ROK-1127 A6)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  function makeService(settingsStore: Map<string, string>): {
    service: DiscoveryCategoriesService;
    chat: jest.Mock;
  } {
    const chat = jest.fn().mockResolvedValue({
      content: JSON.stringify([PROPOSAL]),
      latencyMs: 1,
    });
    const llmService = {
      chat,
      isAvailable: jest.fn().mockResolvedValue(true),
      getActiveProviderKey: jest.fn().mockResolvedValue(null),
    } as unknown as LlmService;
    const settingsService = {
      get: jest.fn((k: string) =>
        Promise.resolve(settingsStore.get(k) ?? null),
      ),
    } as unknown as SettingsService;
    const cronJobService = {
      executeWithTracking: jest.fn(),
    } as unknown as CronJobService;
    const service = new DiscoveryCategoriesService(
      testApp.db,
      cronJobService,
      llmService,
      settingsService,
    );
    return { service, chat };
  }

  function enabledSettings(): Map<string, string> {
    return new Map([[SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED, 'true']]);
  }

  async function seedApproved(name: string, expiresAt: Date): Promise<string> {
    const [row] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name,
        description: 'x',
        categoryType: 'trend',
        themeVector: [0, 0, 0, 0, 0, 0, 0],
        status: 'approved',
        populationStrategy: 'vector',
        expiresAt,
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    return row.id;
  }

  async function seedPending(name: string): Promise<void> {
    await testApp.db.insert(schema.discoveryCategorySuggestions).values({
      name,
      description: 'x',
      categoryType: 'trend',
      themeVector: [0, 0, 0, 0, 0, 0, 0],
      status: 'pending',
      populationStrategy: 'vector',
    });
  }

  async function statusOf(id: string): Promise<string | null> {
    const [row] = await testApp.db
      .select({ status: schema.discoveryCategorySuggestions.status })
      .from(schema.discoveryCategorySuggestions)
      .where(eq(schema.discoveryCategorySuggestions.id, id))
      .limit(1);
    return row?.status ?? null;
  }

  it('generates and expires in a single pass', async () => {
    const { service } = makeService(enabledSettings());
    const stale = await seedApproved('Stale', new Date(Date.now() - 60_000));
    const fresh = await seedApproved('Fresh', new Date(Date.now() + 600_000));

    const result = await service.weeklyGenerate();

    expect(result).toEqual({ inserted: 1, expired: 1 });
    expect(await statusOf(stale)).toBe('expired');
    expect(await statusOf(fresh)).toBe('approved');
    const [pending] = await testApp.db
      .select({ name: schema.discoveryCategorySuggestions.name })
      .from(schema.discoveryCategorySuggestions)
      .where(eq(schema.discoveryCategorySuggestions.status, 'pending'));
    expect(pending?.name).toBe('Weekly Co-op');
  });

  it('still expires stale rows when generation is quota-blocked', async () => {
    const settings = enabledSettings();
    settings.set(SETTING_KEYS.DYNAMIC_CATEGORIES_MAX_PENDING, '1');
    const { service, chat } = makeService(settings);
    await seedPending('Already Pending');
    const stale = await seedApproved('Stale', new Date(Date.now() - 60_000));

    const result = await service.weeklyGenerate();

    expect(result).toEqual({ inserted: 0, expired: 1 });
    expect(chat).not.toHaveBeenCalled();
    expect(await statusOf(stale)).toBe('expired');
  });

  it('bypassQuota lets the admin-triggered pass generate past the cap', async () => {
    const settings = enabledSettings();
    settings.set(SETTING_KEYS.DYNAMIC_CATEGORIES_MAX_PENDING, '1');
    const { service, chat } = makeService(settings);
    await seedPending('Already Pending');

    const result = await service.weeklyGenerate({ bypassQuota: true });

    expect(result.inserted).toBe(1);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
