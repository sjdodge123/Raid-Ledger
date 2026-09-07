/**
 * ROK-1443 — `LineupPhaseQueueService.scheduleTransition` when the base
 * jobId is still ACTIVE.
 *
 * The building-deadline extension re-enqueues `voting` from inside the
 * `voting` job it is running in. BullMQ's `add` with an active job's id is
 * the silent duplicate branch (returns the existing job, stores nothing),
 * and an active job cannot be removed (locked). The replacement must land
 * under the `-r` id or the extended window never fires.
 */
import type { Queue } from 'bullmq';
import { LineupPhaseQueueService } from './lineup-phase.queue';
import {
  LINEUP_PHASE_RESCHEDULED_SUFFIX,
  LINEUP_PHASE_TRANSITION,
} from './lineup-phase.constants';

const BASE_ID = 'lineup-phase-7-voting';
const ALT_ID = `${BASE_ID}${LINEUP_PHASE_RESCHEDULED_SUFFIX}`;

/**
 * BullMQ's OWN custom-id rule, mirrored from bullmq 6.2.0
 * `dist/cjs/classes/job.js:905-913` (`Job.addJob`). It throws BEFORE anything
 * is stored, and `scheduleTransition` swallows the throw into `logger.error`
 * — so an id BullMQ rejects loses the job in silence, and a fake `add` that
 * stores whatever it is handed cannot see it. Returns the rejection reason,
 * or `null` when BullMQ would accept the id.
 */
function bullmqJobIdRejection(jobId: string): string | null {
  if (`${parseInt(jobId, 10)}` === jobId) return 'Custom Id cannot be integers';
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    return 'Custom Id cannot contain :';
  }
  return null;
}

interface FakeJob {
  id: string;
  getState: jest.Mock;
  remove: jest.Mock;
}

function fakeJob(id: string, state: string): FakeJob {
  return {
    id,
    getState: jest.fn().mockResolvedValue(state),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(jobs: Record<string, FakeJob>) {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = {
    add,
    getJob: jest.fn((id: string) => Promise.resolve(jobs[id])),
  } as unknown as Queue;
  const service = new LineupPhaseQueueService(queue, {} as never);
  return { service, add };
}

describe('LineupPhaseQueueService.scheduleTransition (ROK-1443)', () => {
  it('schedules under the base id when nothing occupies it', async () => {
    const { service, add } = buildService({});

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      { lineupId: 7, targetStatus: 'voting' },
      expect.objectContaining({ jobId: BASE_ID, delay: 60_000 }),
    );
  });

  it('re-schedules under the -r id when the base job is still active (the extension fires from inside its own job)', async () => {
    const active = fakeJob(BASE_ID, 'active');
    const { service, add } = buildService({ [BASE_ID]: active });

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(active.remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      { lineupId: 7, targetStatus: 'voting' },
      expect.objectContaining({ jobId: ALT_ID, delay: 60_000 }),
    );
  });

  it('re-schedules under an id BullMQ actually accepts — the original `:r` suffix threw "Custom Id cannot contain :" and the extension was lost (gate round 2, integration case H)', async () => {
    const { service, add } = buildService({
      [BASE_ID]: fakeJob(BASE_ID, 'active'),
    });

    await service.scheduleTransition(7, 'voting', 60_000);

    const opts = add.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).toBe(ALT_ID);
    expect(bullmqJobIdRejection(opts.jobId)).toBeNull();
  });

  it('clears a pending -r twin before re-adding under the free base id', async () => {
    const parked = fakeJob(ALT_ID, 'delayed');
    const { service, add } = buildService({ [ALT_ID]: parked });

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(parked.remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      expect.anything(),
      expect.objectContaining({ jobId: BASE_ID }),
    );
  });

  it('cancelAllForLineup removes a pending -r job too', async () => {
    const parked = fakeJob(ALT_ID, 'delayed');
    const { service } = buildService({ [ALT_ID]: parked });

    const removed = await service.cancelAllForLineup(7);

    expect(removed).toBe(1);
    expect(parked.remove).toHaveBeenCalledTimes(1);
  });
});
