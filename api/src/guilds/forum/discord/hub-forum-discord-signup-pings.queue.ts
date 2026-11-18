/**
 * ROK-2260 — the debounce: every signup change on an event (re)arms ONE
 * delayed BullMQ job per event (`signupPingJobId`), so the flush runs
 * ~2 min after the event's LAST change. Restart-safe (the job lives in
 * Redis), unlike an in-memory timer. Pattern: ROK-1549's poll-embed queue.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  SIGNUP_PING_DEBOUNCE_MS,
  signupPingJobId,
} from './hub-forum-discord-signup-pings';

export const SIGNUP_PING_QUEUE = 'hub-forum-signup-pings';

/** Payload of a flush job. */
export interface SignupPingJobData {
  eventId: number;
}

const JOB_OPTIONS = {
  delay: SIGNUP_PING_DEBOUNCE_MS,
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: 50,
} as const;

type SlotOutcome = 'debounced' | 'busy' | 'free';

@Injectable()
export class HubForumDiscordSignupPingQueue {
  private readonly logger = new Logger(HubForumDiscordSignupPingQueue.name);

  constructor(@InjectQueue(SIGNUP_PING_QUEUE) private readonly queue: Queue) {}

  /**
   * (Re)arm the event's flush. A delayed job gets its timer reset; one that
   * is already running may have read the signups before this change, so a
   * trailing job is armed behind it. Never throws into the signup path.
   */
  async schedule(eventId: number): Promise<void> {
    try {
      const primary = signupPingJobId(eventId);
      const outcome = await this.debounce(primary);
      if (outcome === 'free') return await this.add(primary, eventId);
      if (outcome === 'debounced') return;
      const trail = signupPingJobId(eventId, true);
      if ((await this.debounce(trail)) === 'free') {
        await this.add(trail, eventId);
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Signup ping flush for event ${eventId} not armed: ${why}`,
      );
    }
  }

  private async debounce(jobId: string): Promise<SlotOutcome> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'free';
    const state = await job.getState();
    if (state === 'delayed') {
      await job.changeDelay(SIGNUP_PING_DEBOUNCE_MS);
      return 'debounced';
    }
    if (state === 'completed' || state === 'failed') {
      // ROK-1762: a retained finished job would make `add` a silent no-op.
      await job.remove();
      return 'free';
    }
    return 'busy';
  }

  private async add(jobId: string, eventId: number): Promise<void> {
    const data: SignupPingJobData = { eventId };
    await this.queue.add('flush-signup-pings', data, { ...JOB_OPTIONS, jobId });
  }
}
