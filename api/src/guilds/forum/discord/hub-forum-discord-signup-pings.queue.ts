/**
 * ROK-2260 — the debounce: every signup change on an event (re)arms ONE
 * delayed BullMQ job per event (`signupPingJobId`), so the flush runs
 * ~2 min after the event's LAST change. Restart-safe (the job lives in
 * Redis), unlike an in-memory timer. Pattern: ROK-1549's poll-embed queue.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
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

/** A slot for the urgent flush: `due` = it will run now and read fresh. */
type UrgentOutcome = 'due' | 'busy' | 'free';

/** Job states that have not read the signups yet. */
const NOT_STARTED = new Set(['waiting', 'prioritized', 'waiting-children']);

@Injectable()
export class HubForumDiscordSignupPingQueue {
  private readonly logger = new Logger(HubForumDiscordSignupPingQueue.name);

  constructor(@InjectQueue(SIGNUP_PING_QUEUE) private readonly queue: Queue) {}

  /**
   * (Re)arm the event's flush. At most one flush is pending per event, and
   * it runs a full debounce window after the LAST change: a waiting trailing
   * flush is re-armed first (Codex P2-1), else the primary's timer is reset.
   * A primary already running may have read the signups before this change,
   * so a trailing flush is armed behind it. Never throws into the signup
   * path; resolves false when the flush could not be armed.
   */
  async schedule(eventId: number): Promise<boolean> {
    try {
      await this.arm(eventId);
      return true;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Signup ping flush for event ${eventId} not armed: ${why}`,
      );
      return false;
    }
  }

  private async arm(eventId: number): Promise<void> {
    const trail = signupPingJobId(eventId, true);
    const trailSlot = await this.debounce(trail);
    if (trailSlot === 'debounced') return;
    const primary = signupPingJobId(eventId);
    const outcome = await this.debounce(primary);
    if (outcome === 'free') return this.add(primary, eventId);
    if (outcome === 'busy' && trailSlot === 'free') {
      await this.add(trail, eventId);
    }
  }

  /**
   * ROK-2271 C4 — run the event's flush NOW (running late, roach-out). Same
   * job ids as `schedule`, so it is the SAME flush, never a second one: a
   * pending debounced flush is promoted (it then also carries any other
   * change that was waiting), a running one gets a zero-delay trailing
   * flush behind it. The worker runs one flush at a time and each diffs
   * against the posted-state hash, so no line is posted twice. Never throws.
   */
  async flushNow(eventId: number): Promise<boolean> {
    try {
      await this.armNow(eventId);
      return true;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Urgent signup flush for ${eventId} not armed: ${why}`);
      return false;
    }
  }

  private async armNow(eventId: number): Promise<void> {
    const trail = signupPingJobId(eventId, true);
    const trailSlot = await this.hurry(trail);
    if (trailSlot === 'due') return;
    const primary = signupPingJobId(eventId);
    const outcome = await this.hurry(primary);
    if (outcome === 'free') return this.add(primary, eventId, 0);
    if (outcome === 'busy' && trailSlot === 'free') {
      await this.add(trail, eventId, 0);
    }
  }

  /** Make a queued flush due now; `busy` = it is running already. */
  private async hurry(jobId: string): Promise<UrgentOutcome> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'free';
    const state = await job.getState();
    if (NOT_STARTED.has(state)) return 'due';
    if (state === 'completed' || state === 'failed') {
      await job.remove();
      return 'free';
    }
    if (state !== 'delayed') return 'busy';
    try {
      await job.promote();
      return 'due';
    } catch {
      return 'busy'; // promoted and started between getState and promote
    }
  }

  private async debounce(jobId: string): Promise<SlotOutcome> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'free';
    const state = await job.getState();
    if (state === 'delayed') return this.resetTimer(job);
    if (state === 'completed' || state === 'failed') {
      // ROK-1762: a retained finished job would make `add` a silent no-op.
      await job.remove();
      return 'free';
    }
    return 'busy';
  }

  /**
   * Review r1 m1: the job can be promoted between `getState` and
   * `changeDelay`; it is then running and may have read the signups before
   * this change, so treat it as busy (a trailing flush gets armed).
   */
  private async resetTimer(job: Job): Promise<SlotOutcome> {
    try {
      await job.changeDelay(SIGNUP_PING_DEBOUNCE_MS);
      return 'debounced';
    } catch {
      return 'busy';
    }
  }

  private async add(
    jobId: string,
    eventId: number,
    delay: number = SIGNUP_PING_DEBOUNCE_MS,
  ): Promise<void> {
    const data: SignupPingJobData = { eventId };
    const opts = { ...JOB_OPTIONS, delay, jobId };
    await this.queue.add('flush-signup-pings', data, opts);
  }
}
