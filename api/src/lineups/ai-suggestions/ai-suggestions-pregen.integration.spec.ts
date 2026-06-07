/**
 * AI Suggestions pre-generation / serve-stale-while-revalidate
 * integration tests (ROK-1316).
 *
 * TDD gate (TDD_WRITE_FAILING): these tests define the behaviour of the
 * debounced BullMQ pre-generation + SWR read path BEFORE the
 * implementation lands. They MUST fail until:
 *   - the request thread NEVER awaits the LLM (cold → `pending: true`,
 *     stale → `stale: true` served from the latest row + pre-gen enqueue)
 *   - a new BullMQ queue (jobId `ai-suggestions-pregen-<lineupId>`) with
 *     debounced enqueue from voter-set mutations
 *   - the `?personalize=me` LLM path is DELETED (zero LlmService calls)
 *   - additive contract fields `pending?` / `stale?` on
 *     `AiSuggestionsResponseDto`
 *   - telemetry log lines `result=hit|stale_served|miss_cold` and
 *     `personalize=me served-from-base`
 *
 * Maps to spec ACs:
 *   AC1  — cold cache → 200 `pending:true` in <5s, zero request-thread LLM
 *   AC2  — stale row  → 200 `stale:true` + pre-gen job enqueued
 *   AC3  — `?personalize=me` → base suggestions, ZERO LlmService calls
 *   AC4  — voter-set mutation burst → exactly ONE pre-gen job (debounce)
 *   AC6  — telemetry log lines emitted for hit / stale_served / miss_cold
 *          / served-from-base
 *
 * Style reference: `lineup-auto-advance-grace.integration.spec.ts`
 * (raw-queue handle via getQueueToken, runtime-resolved symbols so the
 * spec file still compiles before the implementation lands).
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { LlmService } from '../../ai/llm.service';
import { computeVoterSetHash } from './voter-scope.helpers';

/**
 * The new pre-gen queue name. Resolved at runtime against the registry
 * so this spec FILE still compiles before the implementation adds the
 * constant — failure then manifests at test time (getQueueToken throws
 * or the queue handle is undefined), which is the TDD "fails-by-
 * construction" mode the brief allows.
 */

function resolvePreGenQueueName(): string {
  try {
    // Implementation is expected to export the constant from a new module.
    // Until it exists, fall back to the spec'd literal so the queue handle
    // lookup simply finds nothing (→ enqueue assertions fail).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./pre-gen.queue');
    return (mod.AI_SUGGESTIONS_PREGEN_QUEUE as string) ?? PREGEN_QUEUE_FALLBACK;
  } catch {
    return PREGEN_QUEUE_FALLBACK;
  }
}
const PREGEN_QUEUE_FALLBACK = 'ai-suggestions-pregen';
const PREGEN_QUEUE = resolvePreGenQueueName();

function describePreGen() {
  let testApp: TestApp;
  let adminToken: string;
  let adminUserId: number;
  let settings: SettingsService;
  let llm: LlmService;
  let preGenQueue: Queue | null;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    settings = testApp.app.get(SettingsService);
    llm = testApp.app.get(LlmService);
    // Resolve the pre-gen queue handle. If the queue is not registered yet
    // (pre-implementation) this throws — caught so the suite can still run
    // and the per-test enqueue assertions are the ones that fail.
    try {
      preGenQueue = testApp.app.get<Queue>(getQueueToken(PREGEN_QUEUE));
    } catch {
      preGenQueue = null;
    }
    await settings.set(SETTING_KEYS_AI_ENABLED, 'true');
  });

  afterEach(async () => {
    if (preGenQueue) await preGenQueue.obliterate({ force: true });
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    adminUserId = await resolveAdminUserId();
  });

  // `truncateAllTables` wipes `app_settings`, so (re)configure a provider +
  // feature flag before EACH test. A configured provider is what
  // distinguishes the cold→`pending` happy path from cold→unavailable
  // (ROK-1316 rework finding #2). Setting `ai_provider` resolves a real
  // registered provider WITHOUT dispatching `chat`.
  beforeEach(async () => {
    await settings.set(SETTING_KEYS_AI_ENABLED, 'true');
    await settings.set(SETTING_KEYS_AI_PROVIDER, 'google');
  });

  const SETTING_KEYS_AI_ENABLED = 'ai_suggestions_enabled';
  const SETTING_KEYS_AI_PROVIDER = 'ai_provider';

  async function resolveAdminUserId(): Promise<number> {
    const [row] = await testApp.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, 'admin'))
      .limit(1);
    return row?.id ?? 0;
  }

  async function createBuildingLineup(): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Pre-gen Test' });
    if (res.status !== 201) {
      throw new Error(
        `createLineup failed: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.id as number;
  }

  async function createGame(tag: string): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Pregen Game ${tag}`,
        slug: `pregen-game-${tag}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
      })
      .returning();
    return game.id;
  }

  /** Directly insert a cached suggestions row under an arbitrary hash so the
   *  read path sees a row for the lineup that does NOT match the current
   *  voter-set hash (→ the SWR "stale" branch). */
  async function seedStaleRow(lineupId: number): Promise<void> {
    await testApp.db.insert(schema.lineupAiSuggestions).values({
      lineupId,
      voterSetHash: computeVoterSetHash([424242]),
      payload: {
        suggestions: [],
        generatedAt: new Date(Date.now() - 60_000).toISOString(),
        voterCount: 1,
        voterScopeStrategy: 'small_group',
      },
      provider: 'test-provider',
      model: 'test-model',
    });
  }

  /** Count delayed/waiting pre-gen jobs for a lineup. */
  async function countPreGenJobs(lineupId: number): Promise<number> {
    if (!preGenQueue) return 0;
    const jobs = await preGenQueue.getJobs(['delayed', 'waiting', 'active']);
    return jobs.filter((j) =>
      String(j.id ?? '').includes(`ai-suggestions-pregen-${lineupId}`),
    ).length;
  }

  // ── AC1: cold cache → pending, never blocks on LLM ─────────────────
  it('AC1: cold cache returns 200 pending:true in <5s with ZERO request-thread LLM calls', async () => {
    const lineupId = await createBuildingLineup();
    const chatSpy = jest.spyOn(llm, 'chat');
    const start = Date.now();
    const res = await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suggestions: [], pending: true });
    expect(elapsed).toBeLessThan(5000);
    // Request thread must NEVER dispatch the LLM.
    expect(chatSpy).not.toHaveBeenCalled();
    // Cold read must enqueue a pre-gen job to warm the cache.
    expect(await countPreGenJobs(lineupId)).toBe(1);
    chatSpy.mockRestore();
  });

  // ── AC2: stale row → stale:true + pre-gen enqueued ─────────────────
  it('AC2: stale row returns 200 stale:true and enqueues a pre-gen job', async () => {
    const lineupId = await createBuildingLineup();
    await seedStaleRow(lineupId);
    const chatSpy = jest.spyOn(llm, 'chat');

    const res = await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    // Stale is served from the existing (most-recent) row's payload.
    expect(res.body).toHaveProperty('suggestions');
    // No synchronous LLM call on the stale read.
    expect(chatSpy).not.toHaveBeenCalled();
    // Stale read must enqueue a pre-gen job to refresh for the new hash.
    expect(await countPreGenJobs(lineupId)).toBe(1);
    chatSpy.mockRestore();
  });

  // ── Rework finding #2: cold cache + NO provider → unavailable, not pending
  it('cold cache with NO provider configured returns unavailable (NOT pending) and enqueues nothing', async () => {
    // Remove the provider configured by beforeEach so resolveActive() → none.
    await settings.set(SETTING_KEYS_AI_PROVIDER, '');
    const lineupId = await createBuildingLineup();
    const chatSpy = jest.spyOn(llm, 'chat');

    const res = await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Controller maps the "No AI provider configured" NotFoundException to
    // 503 → frontend renders its existing `kind:'unavailable'` state. The
    // key invariant: NOT an infinite `pending` skeleton.
    expect(res.status).toBe(503);
    expect(res.body.pending).toBeUndefined();
    // No LLM dispatch and NO doomed pre-gen job.
    expect(chatSpy).not.toHaveBeenCalled();
    expect(await countPreGenJobs(lineupId)).toBe(0);
    chatSpy.mockRestore();
  });

  // ── AC3: personalize=me → base suggestions, ZERO LlmService calls ──
  it('AC3: ?personalize=me returns base suggestions with ZERO LlmService invocations + served-from-base log', async () => {
    const lineupId = await createBuildingLineup();
    const chatSpy = jest.spyOn(llm, 'chat');
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    const res = await testApp.request
      .get(`/lineups/${lineupId}/suggestions?personalize=me`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Same response shape as the base path.
    expect(res.body).toHaveProperty('suggestions');
    expect(res.body).toHaveProperty('voterScopeStrategy');
    // The personalize LLM path is DELETED, not gated — never dispatches.
    expect(chatSpy).not.toHaveBeenCalled();
    // Proves the path was actively rewired to base (not coincidentally empty):
    // the served-from-base telemetry only exists in the new implementation.
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some((l) =>
        l.includes('AI suggestions personalize=me served-from-base'),
      ),
    ).toBe(true);
    chatSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ── AC4: voter-set mutation burst → exactly ONE pre-gen job ────────
  it('AC4: a burst of 3 rapid nominations coalesces to exactly ONE pre-gen job (debounce)', async () => {
    const lineupId = await createBuildingLineup();
    const g1 = await createGame('a');
    const g2 = await createGame('b');
    const g3 = await createGame('c');

    for (const gameId of [g1, g2, g3]) {
      const r = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId });
      expect(r.status).toBeLessThan(300);
    }

    // jobId dedup keyed `ai-suggestions-pregen-<lineupId>` → one job.
    expect(await countPreGenJobs(lineupId)).toBe(1);
  });

  // ── AC6: telemetry log lines ───────────────────────────────────────
  it('AC6: emits result=miss_cold telemetry on a cold read', async () => {
    const lineupId = await createBuildingLineup();
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some(
        (l) =>
          l.includes('AI suggestions cache') && l.includes('result=miss_cold'),
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it('AC6: emits result=stale_served telemetry on a stale read', async () => {
    const lineupId = await createBuildingLineup();
    await seedStaleRow(lineupId);
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some(
        (l) =>
          l.includes('AI suggestions cache') &&
          l.includes('result=stale_served'),
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it('AC6: emits personalize=me served-from-base telemetry', async () => {
    const lineupId = await createBuildingLineup();
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    await testApp.request
      .get(`/lineups/${lineupId}/suggestions?personalize=me`)
      .set('Authorization', `Bearer ${adminToken}`);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some((l) =>
        l.includes('AI suggestions personalize=me served-from-base'),
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  it('AC6: emits result=hit telemetry when a fresh row matches the current hash', async () => {
    const lineupId = await createBuildingLineup();
    // Seed a fresh row under the CURRENT (empty voter-set) hash so the read
    // is a fresh hit. The empty voter set hashes deterministically.
    await testApp.db.insert(schema.lineupAiSuggestions).values({
      lineupId,
      voterSetHash: computeVoterSetHash([]),
      payload: {
        suggestions: [],
        generatedAt: new Date().toISOString(),
        voterCount: 0,
        voterScopeStrategy: 'community',
      },
      provider: 'test-provider',
      model: 'test-model',
    });
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    const res = await testApp.request
      .get(`/lineups/${lineupId}/suggestions`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some(
        (l) => l.includes('AI suggestions cache') && l.includes('result=hit'),
      ),
    ).toBe(true);
    logSpy.mockRestore();
  });

  // ── AC5: processor no-ops on fresh row; skips inactive lineups ─────
  //
  // Drives the REAL processor (resolved from the Nest container, mirroring
  // how the grace spec drives LineupPhaseProcessor.processGraceAdvance).
  // The processor module/symbol does not exist yet → fails-by-construction.
  function getProcessor(): {
    process(job: { data: { lineupId: number } }): Promise<unknown>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./pre-gen.processor');
    const ProcessorClass = mod.AiSuggestionsPreGenProcessor;
    return testApp.app.get(ProcessorClass);
  }

  it('AC5: processor NO-OPs (no LLM) when a fresh row already exists for the current hash', async () => {
    const lineupId = await createBuildingLineup();
    // Seed a fresh row under the current (empty) voter-set hash.
    await testApp.db.insert(schema.lineupAiSuggestions).values({
      lineupId,
      voterSetHash: computeVoterSetHash([]),
      payload: {
        suggestions: [],
        generatedAt: new Date().toISOString(),
        voterCount: 0,
        voterScopeStrategy: 'community',
      },
      provider: 'test-provider',
      model: 'test-model',
    });
    const chatSpy = jest.spyOn(llm, 'chat');

    const processor = getProcessor();
    await processor.process({ data: { lineupId } });

    // Fresh row present → processor must short-circuit without an LLM call.
    expect(chatSpy).not.toHaveBeenCalled();
    chatSpy.mockRestore();
  });

  it('AC5: processor SKIPS inactive (non-building) lineups without dispatching the LLM', async () => {
    const lineupId = await createBuildingLineup();
    // Flip the lineup out of an active phase.
    await testApp.db.execute(sql`
      UPDATE community_lineups SET status = 'archived' WHERE id = ${lineupId}
    `);
    const chatSpy = jest.spyOn(llm, 'chat');

    const processor = getProcessor();
    await processor.process({ data: { lineupId } });

    expect(chatSpy).not.toHaveBeenCalled();
    chatSpy.mockRestore();
  });

  it('AC5: processor handles a deleted/missing lineup gracefully (no throw, no LLM)', async () => {
    const chatSpy = jest.spyOn(llm, 'chat');
    const processor = getProcessor();
    await expect(
      processor.process({ data: { lineupId: 9_999_999 } }),
    ).resolves.not.toThrow();
    expect(chatSpy).not.toHaveBeenCalled();
    chatSpy.mockRestore();
  });

  // keep adminUserId referenced (assigned in afterEach) to avoid unused warns
  it('sanity: admin user resolves', () => {
    expect(typeof adminUserId).toBe('number');
  });
}

describe('AI Suggestions pre-gen / SWR integration (ROK-1316)', describePreGen);
