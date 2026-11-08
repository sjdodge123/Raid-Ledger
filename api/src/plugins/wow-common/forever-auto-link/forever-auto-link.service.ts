/**
 * ROK-2124: auto-link a LedgerLink-bound WoW: Forever character to its
 * Battle.net Armory profile. `attempt` is the import nudge; `runDue` is the
 * hourly capped retry + backfill job. Nothing is shown to the player and
 * nothing is unlinked on failure — a failure only backs the row off.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import { isForeverArmoryImportEnabled } from '../forever-armory-switch';
import { isForeverTwoPartName } from '../forever-character-slug';
import * as apply from './forever-auto-link.apply';
import {
  AUTOLINK_CAP,
  AUTOLINK_SCAN_LIMIT,
  AUTOLINK_SPACING_MS,
  classifyAutoLinkError,
  isAutoLinkCandidateShape,
  stopsAutoLinkRun,
  type AutoLinkErrorKind,
} from './forever-auto-link.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type WaitFn = (ms: number) => Promise<void>;

/** Injection token for the inter-attempt pause (tests pass a no-op). */
export const AUTOLINK_WAIT = Symbol('AUTOLINK_WAIT');

/** What one attempt did. */
export type AutoLinkOutcome =
  'linked' | 'lost_race' | 'skipped' | 'disabled' | AutoLinkErrorKind;

/** One job run's outcome counts (absent key = 0). */
export type AutoLinkTally = Partial<Record<AutoLinkOutcome, number>>;

const defaultWait: WaitFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ForeverAutoLinkService {
  private readonly logger = new Logger(ForeverAutoLinkService.name);
  private running = false;
  private readonly wait: WaitFn;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly adapter: BlizzardCharacterSyncAdapter,
    @Optional() @Inject(AUTOLINK_WAIT) wait?: WaitFn,
  ) {
    this.wait = wait ?? defaultWait;
  }

  /**
   * Try to link one character. No-op (no Blizzard call, no backoff change)
   * while the kill switch is off, Blizzard is unconfigured, or the row is
   * not a due candidate.
   */
  async attempt(characterId: string): Promise<AutoLinkOutcome> {
    if (!(await this.isEnabled())) return 'disabled';
    const gameId = await apply.findForeverGameId(this.db);
    if (gameId === null) return 'skipped';
    return this.attemptEnabled(characterId, gameId);
  }

  /**
   * Hourly job: up to {@link AUTOLINK_CAP} due candidates oldest-first,
   * spaced {@link AUTOLINK_SPACING_MS}; an upstream error ends the run.
   * @returns the tally, or null when skipped (overlap / disabled).
   */
  async runDue(): Promise<AutoLinkTally | null> {
    if (this.running) {
      this.logger.warn('Forever auto-link already in progress, skipping');
      return null;
    }
    this.running = true;
    try {
      if (!(await this.isEnabled())) return null;
      const gameId = await apply.findForeverGameId(this.db);
      if (gameId === null) return null;
      const ids = await apply.listDueCandidateIds(
        this.db,
        gameId,
        new Date(),
        AUTOLINK_SCAN_LIMIT,
      );
      const tally = await this.attemptAll(ids, gameId);
      this.logger.log(`Forever auto-link run: ${JSON.stringify(tally)}`);
      return tally;
    } finally {
      this.running = false;
    }
  }

  /**
   * Only an attempt that reaches Blizzard spends a cap slot or the spacing
   * pause (taken right before the call); an `invalid_name` / `skipped` row
   * costs neither.
   */
  private async attemptAll(
    ids: string[],
    gameId: number,
  ): Promise<AutoLinkTally> {
    const tally: AutoLinkTally = {};
    let calls = 0;
    const beforeCall = async (): Promise<void> => {
      if (calls > 0) await this.wait(AUTOLINK_SPACING_MS);
      calls += 1;
    };
    for (const id of ids) {
      if (calls >= AUTOLINK_CAP) break;
      const outcome = await this.attemptEnabled(id, gameId, beforeCall);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      if (isErrorKind(outcome) && stopsAutoLinkRun(outcome)) break;
    }
    return tally;
  }

  private async isEnabled(): Promise<boolean> {
    if (!(await isForeverArmoryImportEnabled(this.settings))) return false;
    return this.settings.isBlizzardConfigured();
  }

  private async attemptEnabled(
    characterId: string,
    gameId: number,
    beforeCall: () => Promise<void> = () => Promise.resolve(),
  ): Promise<AutoLinkOutcome> {
    const now = new Date();
    const target = await apply.loadAutoLinkTarget(this.db, characterId);
    if (!target) return 'skipped';
    const { row, state } = target;
    if (!isAutoLinkCandidateShape(row, gameId)) return 'skipped';
    if (state && isBackingOff(state, row.name, now)) return 'skipped';
    if (!isForeverTwoPartName(row.name)) {
      const failures = (state?.failures ?? 0) + 1;
      const kind = 'invalid_name';
      await apply.recordAutoLinkFailure(this.db, row.id, failures, kind, now);
      return kind;
    }
    // Atomic claim: a concurrent nudge / job attempt on this row skips.
    const prior = await apply.claimAutoLinkAttempt(this.db, row.id, now);
    if (prior === null) return 'skipped';
    await beforeCall();
    return this.fetchAndLink(row, prior + 1, now);
  }

  private async fetchAndLink(
    row: apply.RegionedCharacter,
    failures: number,
    now: Date,
  ): Promise<AutoLinkOutcome> {
    let fetched: Awaited<ReturnType<typeof apply.fetchForeverProfile>>;
    try {
      fetched = await apply.fetchForeverProfile(this.db, this.adapter, row);
    } catch (err) {
      const kind = classifyAutoLinkError(err);
      this.logger.debug(`Auto-link ${row.id}: ${kind} (failure ${failures})`);
      await apply.recordAutoLinkFailure(this.db, row.id, failures, kind, now);
      return kind;
    }
    const conflict = await this.externalIdConflict(row, fetched);
    if (conflict) {
      const kind = 'external_id_conflict';
      await apply.recordAutoLinkFailure(this.db, row.id, failures, kind, now);
      return kind;
    }
    const linked = await apply.applyAutoLink(this.db, row, fetched);
    return linked ? 'linked' : 'lost_race';
  }

  /** OQ-5: another row already holds the Blizzard id → warn, don't link. */
  private async externalIdConflict(
    row: apply.RegionedCharacter,
    fetched: Awaited<ReturnType<typeof apply.fetchForeverProfile>>,
  ): Promise<boolean> {
    const externalId = fetched.profile.externalId;
    if (!externalId) return false;
    const holder = await apply.findExternalIdHolder(this.db, row, externalId);
    if (holder === null) return false;
    this.logger.warn(
      `Auto-link skipped for character ${row.id}: Blizzard id already on character ${holder}`,
    );
    return true;
  }
}

function isErrorKind(outcome: AutoLinkOutcome): outcome is AutoLinkErrorKind {
  return (
    outcome === 'not_found' ||
    outcome === 'upstream' ||
    outcome === 'external_id_conflict' ||
    outcome === 'invalid_name'
  );
}

/**
 * Still inside its backoff — except an `invalid_name` row whose CURRENT name
 * is now addressable (renamed since): that one is attempted at once.
 */
function isBackingOff(
  state: { retryAt: Date; lastError: string },
  name: string,
  now: Date,
): boolean {
  if (state.retryAt <= now) return false;
  return !(state.lastError === 'invalid_name' && isForeverTwoPartName(name));
}
