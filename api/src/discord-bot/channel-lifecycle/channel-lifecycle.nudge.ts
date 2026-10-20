import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SettingsService } from '../../settings/settings.service';
import { clearFinishedJob } from '../../queue/clear-finished-job.helpers';

/** BullMQ queue carrying the per-game channel-lifecycle nudge (ROK-1431 D12). */
export const CHANNEL_LIFECYCLE_NUDGE_QUEUE = 'channel-lifecycle-nudge';

/** Debounce window: a vote storm on one game collapses into one job. */
export const NUDGE_DELAY_MS = 60_000;

/** Logger for the static hook entry point (no instance at the call site). */
const hookLogger = new Logger('GameActivityNudge');

/** Payload of one nudge job. */
export interface GameActivityNudgeJobData {
  gameId: number;
}

/**
 * Deterministic job id per game — BullMQ ignores an `add` whose id is pending,
 * which is the dedup. (D12 wrote `channel-lifecycle:game:<id>`; BullMQ forbids
 * `:` in custom ids, so dashes.)
 */
export function nudgeJobId(gameId: number): string {
  return `channel-lifecycle-game-${gameId}`;
}

/**
 * Producer for the per-game nudge: activity on a game (event, poll, vote,
 * event plan) re-reconciles that game's channel within ~60 s instead of
 * waiting for the daily cron.
 */
@Injectable()
export class GameActivityNudge {
  private readonly logger = new Logger(GameActivityNudge.name);

  constructor(
    @InjectQueue(CHANNEL_LIFECYCLE_NUDGE_QUEUE) private readonly queue: Queue,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Fire-and-forget nudge. Never throws and never blocks the caller; a
   * missing game id is a no-op.
   */
  touch(gameId: number | null | undefined): void {
    if (typeof gameId !== 'number') return;
    this.enqueue(gameId).catch((err: unknown) => {
      this.logger.warn(
        `Channel lifecycle nudge for game ${gameId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /**
   * Hook-site entry point: nudge when a producer is wired, and contain even a
   * synchronous throw so a nudge can never fail the caller's write (§2.6).
   */
  static safeTouch(
    nudge: Pick<GameActivityNudge, 'touch'> | undefined,
    gameId: number | null | undefined,
  ): void {
    try {
      nudge?.touch(gameId);
    } catch (err: unknown) {
      hookLogger.warn(
        `Channel lifecycle nudge hook threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Enqueue (or join the pending) nudge job for a game.
   * @returns false when the lifecycle setting is disabled (nothing enqueued).
   */
  async enqueue(gameId: number): Promise<boolean> {
    const settings = await this.settings.getChannelLifecycleSettings();
    if (!settings.enabled) return false;
    const jobId = nudgeJobId(gameId);
    // ROK-1762: a retained finished job would swallow the add.
    await clearFinishedJob(this.queue, jobId);
    const data: GameActivityNudgeJobData = { gameId };
    await this.queue.add('reconcile-game', data, {
      jobId,
      delay: NUDGE_DELAY_MS,
      attempts: 2,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
    return true;
  }
}
