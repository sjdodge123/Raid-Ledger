/**
 * AI Suggestions integration tests (TDD FAILING, ROK-931).
 *
 * Verifies GET /lineups/:id/suggestions end-to-end against real Postgres
 * with `LlmService` overridden to a deterministic mock. Written before
 * the module exists — these tests fail at compile time (cannot find
 * `AiSuggestionsModule`, `AiSuggestionsResponseDto`) and will compile
 * once the dev agent lands Phase A (contract) + Phase B (backend).
 */
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';

function describeAiSuggestions() {
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

  /** Create a lineup in the given status; returns its id. */
  async function createLineup(
    overrides: Partial<typeof schema.communityLineups.$inferInsert> = {},
  ): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: overrides.title ?? 'AI Suggestions Test' });
    if (res.status !== 201) {
      throw new Error(
        `createLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  describe('GET /lineups/:id/suggestions', () => {
    it('returns 404 when the lineup does not exist', async () => {
      const res = await testApp.request
        .get('/lineups/9999999/suggestions')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('returns 409 when the lineup is not in building status', async () => {
      const lineupId = await createLineup();
      // Transition building → voting
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      const res = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('returns 503 when no LLM provider is configured', async () => {
      const lineupId = await createLineup();
      // No ai_provider setting seeded — registry resolves to nothing.
      const res = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('AI_PROVIDER_UNAVAILABLE');
    });

    it('returns 200 with a well-formed payload when provider is configured', async () => {
      // This test will fail until Phase B lands: the registry + mock path
      // are not wired yet. Dev agent seeds `ai_provider` to a stub
      // provider and asserts payload shape.
      const lineupId = await createLineup();
      await testApp.db
        .insert(schema.settings)
        .values({ key: 'ai_provider', value: 'test-stub' })
        .onConflictDoNothing();
      const res = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const body = res.body as AiSuggestionsResponseDto;
      expect(Array.isArray(body.suggestions)).toBe(true);
      expect(body).toEqual(
        expect.objectContaining({
          suggestions: expect.any(Array),
          generatedAt: expect.any(String),
          voterCount: expect.any(Number),
          voterScopeStrategy: expect.stringMatching(
            /^(community|partial|small_group)$/,
          ),
          cached: expect.any(Boolean),
        }),
      );
    });

    it('serves from cache on a second identical request (cached: true)', async () => {
      const lineupId = await createLineup();
      await testApp.db
        .insert(schema.settings)
        .values({ key: 'ai_provider', value: 'test-stub' })
        .onConflictDoNothing();
      const first = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      const second = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((first.body as AiSuggestionsResponseDto).cached).toBe(false);
      expect((second.body as AiSuggestionsResponseDto).cached).toBe(true);
    });
  });
}

describe('AI Suggestions integration (ROK-931)', () => {
  describeAiSuggestions();
});
