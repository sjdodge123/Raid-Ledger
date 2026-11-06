/**
 * GET /admin/cron-jobs/:id/executions parses its `limit` query param: a
 * non-numeric value used to reach SQL as `LIMIT NaN` (a 500) and a
 * negative one passed straight through.
 */
import { CronJobController } from './cron-job.controller';
import type { CronJobService } from './cron-job.service';

function makeController(): {
  controller: CronJobController;
  getExecutionHistory: jest.Mock;
} {
  const getExecutionHistory = jest.fn().mockResolvedValue([]);
  const service = { getExecutionHistory };
  const controller = new CronJobController(
    service as unknown as CronJobService,
  );
  return { controller, getExecutionHistory };
}

describe('CronJobController.getExecutions — limit parsing', () => {
  it('uses 50 when limit is absent', async () => {
    const { controller, getExecutionHistory } = makeController();
    await controller.getExecutions(7);
    expect(getExecutionHistory).toHaveBeenCalledWith(7, 50);
  });

  it('passes a valid limit through', async () => {
    const { controller, getExecutionHistory } = makeController();
    await controller.getExecutions(7, '25');
    expect(getExecutionHistory).toHaveBeenCalledWith(7, 25);
  });

  it('falls back to 50 when limit is not a number', async () => {
    const { controller, getExecutionHistory } = makeController();
    await controller.getExecutions(7, 'abc');
    expect(getExecutionHistory).toHaveBeenCalledWith(7, 50);
  });

  it('clamps a negative limit to 1', async () => {
    const { controller, getExecutionHistory } = makeController();
    await controller.getExecutions(7, '-5');
    expect(getExecutionHistory).toHaveBeenCalledWith(7, 1);
  });

  it('caps a huge limit at 100', async () => {
    const { controller, getExecutionHistory } = makeController();
    await controller.getExecutions(7, '999999');
    expect(getExecutionHistory).toHaveBeenCalledWith(7, 100);
  });
});
