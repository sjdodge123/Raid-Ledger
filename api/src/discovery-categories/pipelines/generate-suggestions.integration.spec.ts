/**
 * Integration tests for `runGenerateSuggestions` (ROK-567). Exercises the
 * full pipeline against a real Postgres while mocking `LlmService.chat`,
 * `SettingsService`, and `LlmProviderRegistry`.
 */
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { LlmCategoryProposalDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema';
import type { LlmService } from '../../ai/llm.service';
import type { SettingsService } from '../../settings/settings.service';
import { runGenerateSuggestions } from './generate-suggestions';

const VALID_PROPOSAL: LlmCategoryProposalDto = {
  name: 'Co-op Chill',
  description: 'Low-stakes co-op evenings.',
  category_type: 'community_pattern',
  theme_vector: {
    co_op: 0.9,
    pvp: -0.1,
    rpg: 0.0,
    survival: 0.2,
    strategy: 0.0,
    social: 0.6,
    mmo: 0.0,
  },
  filter_criteria: {},
  population_strategy: 'vector',
  expires_at: null,
};

interface Fakes {
  chat: jest.Mock;
  isAvailable: jest.Mock;
  get: jest.Mock;
  llmService: LlmService;
  settings: SettingsService;
  settingsStore: Map<string, string>;
}

function makeFakes(): Fakes {
  const settingsStore = new Map<string, string>();
  settingsStore.set(SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED, 'true');
  const chat = jest.fn();
  const isAvailable = jest.fn().mockResolvedValue(true);
  const get = jest.fn((k: string) =>
    Promise.resolve(settingsStore.get(k) ?? null),
  );
  return {
    chat,
    isAvailable,
    get,
    settingsStore,
    llmService: { chat, isAvailable } as unknown as LlmService,
    settings: { get } as unknown as SettingsService,
  };
}

describe('runGenerateSuggestions (ROK-567)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedGameVector(
    name: string,
    vector: number[],
  ): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: name.toLowerCase().replace(/\s+/g, '-') })
      .returning();
    await testApp.db.execute(sql`
      INSERT INTO game_taste_vectors (game_id, vector, dimensions, confidence, signal_hash)
      VALUES (
        ${game.id},
        ${`[${vector.join(',')}]`}::vector,
        '{}'::jsonb,
        0.9,
        ${`h-${game.id}`}
      )
    `);
    return game.id;
  }

  it('skips when no provider is registered', async () => {
    const fakes = makeFakes();
    fakes.isAvailable.mockResolvedValueOnce(false);
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(0);
    expect(fakes.chat).not.toHaveBeenCalled();
  });

  it('skips when the feature flag is off', async () => {
    const fakes = makeFakes();
    fakes.settingsStore.set(
      SETTING_KEYS.AI_DYNAMIC_CATEGORIES_ENABLED,
      'false',
    );
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(0);
    expect(fakes.chat).not.toHaveBeenCalled();
  });

  it('skips when pending quota is reached', async () => {
    const fakes = makeFakes();
    fakes.settingsStore.set(SETTING_KEYS.DYNAMIC_CATEGORIES_MAX_PENDING, '1');
    await testApp.db.insert(schema.discoveryCategorySuggestions).values({
      name: 'Existing Pending',
      description: 'x',
      categoryType: 'trend',
      themeVector: [0, 0, 0, 0, 0, 0, 0],
      status: 'pending',
      populationStrategy: 'vector',
    });
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(0);
    expect(fakes.chat).not.toHaveBeenCalled();
  });

  it('inserts a pending suggestion with resolved candidates on the happy path', async () => {
    const fakes = makeFakes();
    const near = await seedGameVector('Near', [1, 0, 0, 0, 0, 0, 0]);
    fakes.chat.mockResolvedValueOnce({
      content: JSON.stringify([VALID_PROPOSAL]),
      latencyMs: 1,
    });
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(1);
    const rows = await testApp.db
      .select()
      .from(schema.discoveryCategorySuggestions);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].name).toBe('Co-op Chill');
    expect(rows[0].candidateGameIds).toEqual([near]);
  });

  it('still inserts the row with empty candidates when no game vectors exist', async () => {
    const fakes = makeFakes();
    fakes.chat.mockResolvedValueOnce({
      content: JSON.stringify([VALID_PROPOSAL]),
      latencyMs: 1,
    });
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(1);
    const [row] = await testApp.db
      .select()
      .from(schema.discoveryCategorySuggestions);
    expect(row.candidateGameIds).toEqual([]);
  });

  it('leaves approved rows untouched when the LLM is unreachable', async () => {
    const fakes = makeFakes();
    fakes.chat.mockRejectedValue(new Error('upstream 503'));
    const [keep] = await testApp.db
      .insert(schema.discoveryCategorySuggestions)
      .values({
        name: 'Keep Me',
        description: 'x',
        categoryType: 'trend',
        themeVector: [0, 0, 0, 0, 0, 0, 0],
        status: 'approved',
        populationStrategy: 'vector',
      })
      .returning({ id: schema.discoveryCategorySuggestions.id });
    const inserted = await runGenerateSuggestions(testApp.db, {
      llmService: fakes.llmService,
      settingsService: fakes.settings,
      logger: new Logger(),
    });
    expect(inserted).toBe(0);
    const [row] = await testApp.db
      .select({ status: schema.discoveryCategorySuggestions.status })
      .from(schema.discoveryCategorySuggestions)
      .where(eq(schema.discoveryCategorySuggestions.id, keep.id));
    expect(row.status).toBe('approved');
  });
});
