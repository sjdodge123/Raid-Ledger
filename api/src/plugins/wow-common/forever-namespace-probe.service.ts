import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { z } from 'zod';
import {
  ForeverProbeConfigSchema,
  ForeverProbeFoundSchema,
  ForeverProbeResultSchema,
} from '@raid-ledger/contract';
import type {
  ForeverProbeConfigDto,
  ForeverProbeFoundDto,
  ForeverProbeResultDto,
  ForeverProbeStateDto,
} from '@raid-ledger/contract';
import type { SettingKey } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { BlizzardAuthService } from './blizzard-auth.service';
import {
  FOREVER_PROBE_REGIONS,
  buildCandidateList,
  isInLaunchWindow,
  runProbe,
  type ProbeFetch,
  type ProbeRun,
} from './forever-namespace-probe.helpers';
import {
  WOW_FOREVER_PROBE_CHARACTER_KEY,
  WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY,
  WOW_FOREVER_PROBE_FOUND_KEY,
  WOW_FOREVER_PROBE_LAST_RESULT_KEY,
} from './forever.settings';

/** Real network fetch for the probe. */
const probeFetch: ProbeFetch = (url, init) => fetch(url, init);

const ExtraCandidatesSchema = z.array(z.string());

/** A result before its status + duration are known. */
type ProbeBase = Omit<ForeverProbeResultDto, 'status' | 'durationMs'>;

/**
 * WoW: Forever namespace discovery probe (ROK-1716). Reports what Blizzard
 * answers and raises ONE Sentry info event per newly found prefix. It never
 * writes ROK-1717's settings or touches the realm cache (D10).
 */
@Injectable()
export class ForeverNamespaceProbeService {
  private readonly logger = new Logger(ForeverNamespaceProbeService.name);
  private inFlight: Promise<ForeverProbeResultDto> | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly auth: BlizzardAuthService,
  ) {}

  /** Run the probe and persist the result; a run in progress is joined (D8). */
  run(): Promise<ForeverProbeResultDto> {
    if (!this.inFlight) {
      this.inFlight = this.execute().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /** Hourly launch-window job: runs only inside the window, else null (D7). */
  async runIfInLaunchWindow(
    now: Date = new Date(),
  ): Promise<ForeverProbeResultDto | null> {
    if (!isInLaunchWindow(now)) return null;
    return this.run();
  }

  /** Last stored result (null = never ran) plus the admin probe config. */
  async getState(): Promise<ForeverProbeStateDto> {
    return {
      result: await this.readJson(
        WOW_FOREVER_PROBE_LAST_RESULT_KEY,
        ForeverProbeResultSchema,
      ),
      extraCandidates: await this.readExtras(),
      characterPath: await this.settings.get(WOW_FOREVER_PROBE_CHARACTER_KEY),
    };
  }

  /**
   * Validate + persist the probe config; empty values delete the key.
   * @throws BadRequestException when the body fails the contract schema.
   */
  async updateConfig(
    dto: ForeverProbeConfigDto,
  ): Promise<ForeverProbeStateDto> {
    const parsed = ForeverProbeConfigSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const { extraCandidates, characterPath } = parsed.data;
    await this.writeOrDelete(
      WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY,
      extraCandidates.length ? JSON.stringify(extraCandidates) : null,
    );
    await this.writeOrDelete(WOW_FOREVER_PROBE_CHARACTER_KEY, characterPath);
    return this.getState();
  }

  private async execute(): Promise<ForeverProbeResultDto> {
    const started = Date.now();
    const base: ProbeBase = {
      ranAt: new Date(started).toISOString(),
      candidates: buildCandidateList(await this.readExtras()),
      found: await this.readJson(
        WOW_FOREVER_PROBE_FOUND_KEY,
        ForeverProbeFoundSchema,
      ),
      cells: [],
      matches: [],
      shapes: {},
    };
    if (!(await this.settings.isBlizzardConfigured())) {
      return this.persist({ ...base, status: 'skipped', durationMs: 0 });
    }
    return this.probeAndPersist(base, started);
  }

  /** Probe, record any new find, persist; a failure persists `error` (no throw). */
  private async probeAndPersist(
    base: ProbeBase,
    started: number,
  ): Promise<ForeverProbeResultDto> {
    try {
      const run = await this.probe(base.candidates);
      const found = await this.recordFound(run, base.found, base.ranAt);
      this.logShapes(run);
      const durationMs = Date.now() - started;
      return this.persist({ ...base, ...run, status: 'ok', found, durationMs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Forever namespace probe failed: ${msg}`);
      const durationMs = Date.now() - started;
      return this.persist({ ...base, status: 'error', durationMs });
    }
  }

  private async probe(candidates: string[]): Promise<ProbeRun> {
    return runProbe({
      fetchFn: probeFetch,
      token: await this.auth.getAccessToken('us'),
      candidates,
      regions: FOREVER_PROBE_REGIONS,
      characterPath: await this.settings.get(WOW_FOREVER_PROBE_CHARACTER_KEY),
    });
  }

  /** Store + alert only on a transition to a new prefix (D4). */
  private async recordFound(
    run: ProbeRun,
    stored: ForeverProbeFoundDto | null,
    at: string,
  ): Promise<ForeverProbeFoundDto | null> {
    const prefix = run.matches[0]?.prefix;
    if (!prefix || stored?.prefix === prefix) return stored;
    const found: ForeverProbeFoundDto = { prefix, at };
    await this.settings.set(WOW_FOREVER_PROBE_FOUND_KEY, JSON.stringify(found));
    const own = run.cells.filter((c) => c.prefix === prefix);
    Sentry.captureMessage(`Forever namespace found: ${prefix}`, {
      level: 'info',
      tags: { context: 'wow-forever-probe' },
      extra: {
        regions: run.matches
          .filter((m) => m.prefix === prefix)
          .map((m) => m.region),
        endpoints: own
          .filter((c) => c.status === 200)
          .map((c) => `${c.region}:${c.endpoint}`),
        profileStatus: own
          .filter((c) => c.endpoint === 'profile')
          .map((c) => c.status),
      },
    });
    this.logger.log(`Forever namespace found: ${prefix}`);
    return found;
  }

  /** Log each 200 index shape for ROK-1718 (D6). */
  private logShapes(run: ProbeRun): void {
    for (const [key, shape] of Object.entries(run.shapes)) {
      this.logger.log(`Forever probe shape ${key}: ${JSON.stringify(shape)}`);
    }
  }

  private async persist(
    result: ForeverProbeResultDto,
  ): Promise<ForeverProbeResultDto> {
    await this.settings.set(
      WOW_FOREVER_PROBE_LAST_RESULT_KEY,
      JSON.stringify(result),
    );
    return result;
  }

  private async readExtras(): Promise<string[]> {
    const key = WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY;
    return (await this.readJson(key, ExtraCandidatesSchema)) ?? [];
  }

  /** Parse a JSON setting; absent or corrupt = null. */
  private async readJson<T>(
    key: SettingKey,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    const raw = await this.settings.get(key);
    if (!raw) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async writeOrDelete(
    key: SettingKey,
    value: string | null,
  ): Promise<void> {
    if (value === null) await this.settings.delete(key);
    else await this.settings.set(key, value);
  }
}
