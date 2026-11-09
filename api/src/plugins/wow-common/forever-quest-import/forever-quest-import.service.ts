/**
 * ROK-2143: admin-triggered background import of classic dungeon quest data
 * from the Blizzard WoW: Forever API into the `wow_dungeon_quest_blizzard`
 * overlay. Manual only (no cron). One run at a time (in-memory flag + the
 * persisted `running` marker); the report lives in a plugin setting.
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import { isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { BlizzardAuthService } from '../blizzard-auth.service';
import { WOW_FOREVER_QUEST_IMPORT_STATUS_KEY } from '../forever.settings';
import { listStaleQuestIds, upsertBlizzardQuests } from './blizzard-quest.repo';
import {
  FOREVER_QUEST_IMPORT_OFF_MESSAGE,
  isForeverQuestImportEnabled,
} from './forever-quest-import-switch';
import {
  QuestImportCrawl,
  type QuestImportDeps,
} from './forever-quest-import.crawl';
import {
  FOREVER_QUEST_IMPORT_REGION,
  FOREVER_QUEST_IMPORT_SENTRY_CONTEXT,
  FOREVER_QUEST_IMPORT_STALE_RUNNING_MS,
  ForeverQuestImportReportSchema,
  QuestImportAbort,
  emptyQuestImportReport,
  pushQuestImportError,
  type ForeverQuestImportReport,
} from './forever-quest-import.report';

type Db = PostgresJsDatabase<typeof schema>;

export const FOREVER_QUEST_IMPORT_UNCONFIGURED_MESSAGE =
  'Blizzard API credentials are not configured. Add them on the Blizzard plugin page, then run the quest import again.';
export const FOREVER_QUEST_IMPORT_RUNNING_MESSAGE =
  'A WoW: Forever quest import is already running';

@Injectable()
export class ForeverQuestImportService {
  private readonly logger = new Logger(ForeverQuestImportService.name);
  private busy = false;
  private active: ForeverQuestImportReport | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly auth: BlizzardAuthService,
  ) {}

  /** The run in progress (the integration spec awaits it); null when idle. */
  get currentRun(): Promise<void> | null {
    return this.inFlight;
  }

  /** Pause between requests — a method so the integration spec can stub it. */
  pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** The live report while running, else the last stored one (or `idle`). */
  async getStatus(): Promise<ForeverQuestImportReport> {
    return this.active ?? (await this.readReport()) ?? emptyQuestImportReport();
  }

  /**
   * Start a run in the background and return its `running` report.
   * @throws ForbiddenException kill switch off; ConflictException unconfigured / already running.
   */
  async start(): Promise<ForeverQuestImportReport> {
    if (this.busy)
      throw new ConflictException(FOREVER_QUEST_IMPORT_RUNNING_MESSAGE);
    this.busy = true;
    try {
      const report = await this.prepare();
      this.active = report;
      this.inFlight = this.execute(report).finally(() => {
        this.active = null;
        this.inFlight = null;
        this.busy = false;
      });
      return report;
    } catch (err: unknown) {
      this.busy = false;
      throw err;
    }
  }

  private async prepare(): Promise<ForeverQuestImportReport> {
    if (!(await isForeverQuestImportEnabled(this.settings))) {
      throw new ForbiddenException(FOREVER_QUEST_IMPORT_OFF_MESSAGE);
    }
    if (!(await this.settings.isBlizzardConfigured())) {
      throw new ConflictException(FOREVER_QUEST_IMPORT_UNCONFIGURED_MESSAGE);
    }
    if (isLiveRunningMarker(await this.readReport(), new Date())) {
      throw new ConflictException(FOREVER_QUEST_IMPORT_RUNNING_MESSAGE);
    }
    const report: ForeverQuestImportReport = {
      ...emptyQuestImportReport(),
      status: 'running',
      runId: randomUUID(),
      startedAt: new Date().toISOString(),
    };
    await this.persist(report);
    return report;
  }

  private async execute(report: ForeverQuestImportReport): Promise<void> {
    const runId = report.runId ?? randomUUID();
    try {
      await new QuestImportCrawl(await this.buildDeps(runId), report).run();
      report.staleQuestIds = await listStaleQuestIds(this.db, runId);
      report.status = 'succeeded';
    } catch (err: unknown) {
      this.recordFailure(report, err);
    }
    report.finishedAt = new Date().toISOString();
    this.logger.log(
      `Forever quest import ${report.status}: ${JSON.stringify(report.counts)}`,
    );
    await this.persist(report).catch((err: unknown) => {
      this.logger.error(
        `Forever quest import report not saved: ${String(err)}`,
      );
    });
  }

  private async buildDeps(runId: string): Promise<QuestImportDeps> {
    const region = FOREVER_QUEST_IMPORT_REGION;
    const token = await this.auth.getAccessToken(region);
    return {
      region,
      runId,
      knownQuests: await this.loadKnownQuests(),
      fetchJson: async (url) => {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body: unknown = res.ok ? await res.json() : null;
        return { status: res.status, body };
      },
      pause: (ms) => this.pause(ms),
      isEnabled: () => isForeverQuestImportEnabled(this.settings),
      saveQuest: async (row) => {
        await upsertBlizzardQuests(this.db, [row]);
      },
    };
  }

  /** Bundled classic quests: quest id → dungeon instance id. */
  private async loadKnownQuests(): Promise<Map<number, number>> {
    const t = schema.wowClassicDungeonQuests;
    const rows = await this.db
      .select({ questId: t.questId, instanceId: t.dungeonInstanceId })
      .from(t)
      .where(isNotNull(t.dungeonInstanceId));
    const out = new Map<number, number>();
    for (const r of rows)
      if (r.instanceId !== null) out.set(r.questId, r.instanceId);
    return out;
  }

  /** `failed` + the error line; Sentry for anything but the kill switch. */
  private recordFailure(report: ForeverQuestImportReport, err: unknown): void {
    report.status = 'failed';
    const msg = err instanceof Error ? err.message : String(err);
    pushQuestImportError(report, msg);
    this.logger.warn(`Forever quest import failed: ${msg}`);
    if (
      err instanceof QuestImportAbort &&
      msg === FOREVER_QUEST_IMPORT_OFF_MESSAGE
    )
      return;
    Sentry.captureException(err, {
      tags: { context: FOREVER_QUEST_IMPORT_SENTRY_CONTEXT },
      extra: { runId: report.runId, counts: report.counts },
    });
  }

  private async readReport(): Promise<ForeverQuestImportReport | null> {
    const raw = await this.settings.get(WOW_FOREVER_QUEST_IMPORT_STATUS_KEY);
    if (!raw) return null;
    try {
      const parsed = ForeverQuestImportReportSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private persist(report: ForeverQuestImportReport): Promise<void> {
    return this.settings.set(
      WOW_FOREVER_QUEST_IMPORT_STATUS_KEY,
      JSON.stringify(report),
    );
  }
}

/** A stored `running` marker younger than the stale cut-off (another instance's run). */
export function isLiveRunningMarker(
  report: ForeverQuestImportReport | null,
  now: Date,
): boolean {
  if (report?.status !== 'running' || report.startedAt === null) return false;
  const age = now.getTime() - Date.parse(report.startedAt);
  return age < FOREVER_QUEST_IMPORT_STALE_RUNNING_MS;
}
