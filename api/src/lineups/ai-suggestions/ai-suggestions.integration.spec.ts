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
  });
}

describe('AI Suggestions integration (ROK-931)', () => {
  describeAiSuggestions();
});
