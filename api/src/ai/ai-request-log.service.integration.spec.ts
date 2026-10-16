/**
 * Regression: `getLastSuccessfulChatAt` must return a real `Date`.
 *
 * It selects a raw `max(created_at)`. A raw `sql` select has no column
 * decoder, so without `.mapWith(aiRequestLogs.createdAt)` postgres.js returns
 * the timestamp as a string and `deriveAvailability` crashed in prod with
 * `opts.lastSuccessAt.getTime is not a function`. A mocked DB cannot catch
 * this, so it runs against real Postgres.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { aiRequestLogs } from '../drizzle/schema';
import { AiRequestLogService } from './ai-request-log.service';

let testApp: TestApp;
let service: AiRequestLogService;

const PROVIDER = 'ollama';

function logRow(createdAt: Date, success: boolean, provider = PROVIDER) {
  return {
    feature: 'chat',
    provider,
    model: 'test-model',
    latencyMs: 10,
    success,
    createdAt,
  };
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = new AiRequestLogService(testApp.db);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('AiRequestLogService.getLastSuccessfulChatAt (integration)', () => {
  it('returns the latest successful created_at as a Date', async () => {
    const success = new Date('2026-10-16T16:24:05.123Z');
    await testApp.db
      .insert(aiRequestLogs)
      .values([
        logRow(new Date('2026-10-16T10:00:00.000Z'), true),
        logRow(success, true),
        logRow(new Date('2026-10-16T17:00:00.000Z'), false),
        logRow(new Date('2026-10-16T18:00:00.000Z'), true, 'other'),
      ]);

    const result = await service.getLastSuccessfulChatAt(PROVIDER);

    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe(success.toISOString());
  });

  it('returns null when the provider has no successful chat', async () => {
    const result = await service.getLastSuccessfulChatAt(PROVIDER);

    expect(result).toBeNull();
  });
});
