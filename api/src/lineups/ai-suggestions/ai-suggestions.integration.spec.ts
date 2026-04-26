/**
 * AI Suggestions integration tests (ROK-931).
 *
 * Validates GET /lineups/:id/suggestions end-to-end against real
 * Postgres. Focus is route integrity — status + module + controller
 * are all wired and respond with the correct HTTP codes. Payload shape
 * and provider-level behaviour are covered by unit specs
 * (voter-scope, llm-output) and the AI facade's own tests — seeding a
 * stub LLM provider via encrypted SettingsService is prohibitively
 * intricate for integration coverage.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { SettingsService } from '../../settings/settings.service';
import { LlmService } from '../../ai/llm.service';
import { SETTING_KEYS } from '../../drizzle/schema';

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

  async function createLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'AI Suggestions Test' });
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
      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });
      const res = await testApp.request
        .get(`/lineups/${lineupId}/suggestions`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('returns 401 when unauthenticated', async () => {
      const lineupId = await createLineup();
      const res = await testApp.request.get(`/lineups/${lineupId}/suggestions`);
      expect(res.status).toBe(401);
    });

    /**
     * ROK-1114 round 3: when admin disables the feature, the endpoint
     * MUST return 200 with empty suggestions and MUST NOT call the LLM.
     * 503 would be wrong — it maps to "temporarily unavailable" UX,
     * which is misleading for an intentional admin disable.
     */
    it('returns 200 with empty suggestions and does NOT call LlmService.chat when ai_suggestions_enabled is false', async () => {
      const lineupId = await createLineup();
      const settings = testApp.app.get(SettingsService);
      const llm = testApp.app.get(LlmService);
      const chatSpy = jest.spyOn(llm, 'chat');
      await settings.set(SETTING_KEYS.AI_SUGGESTIONS_ENABLED, 'false');
      try {
        const res = await testApp.request
          .get(`/lineups/${lineupId}/suggestions`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          suggestions: [],
          voterCount: 0,
          cached: false,
        });
        expect(chatSpy).not.toHaveBeenCalled();
      } finally {
        chatSpy.mockRestore();
        await settings.set(SETTING_KEYS.AI_SUGGESTIONS_ENABLED, 'true');
      }
    });
  });
}

describe('AI Suggestions integration (ROK-931)', () => {
  describeAiSuggestions();
});
