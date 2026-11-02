/**
 * Unit tests for the updateStatus side effects (ROK-1728 review MINOR 3).
 */
import { afterStatusChange } from './signups-status.helpers';

function setup() {
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const allocation = {
    checkTentativeDisplacement: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { warn: jest.fn(), log: jest.fn() };
  const row = { id: 7, eventId: 3, userId: 42 };
  return { activityLog, allocation, logger, row };
}

describe('afterStatusChange', () => {
  it('audits the change by default (re-join reads it as the user decision)', async () => {
    const { activityLog, allocation, logger, row } = setup();
    await afterStatusChange(activityLog, allocation, logger, row, {
      status: 'declined',
    });
    expect(activityLog.log).toHaveBeenCalledWith(
      'event',
      3,
      'signup_status_changed',
      42,
      { status: 'declined' },
    );
    expect(allocation.checkTentativeDisplacement).not.toHaveBeenCalled();
  });

  it('skips the audit row when the caller opts out, but still runs the tentative displacement check', async () => {
    const { activityLog, allocation, logger, row } = setup();
    await afterStatusChange(activityLog, allocation, logger, row, {
      status: 'tentative',
      audit: false,
    });
    expect(activityLog.log).not.toHaveBeenCalled();
    expect(allocation.checkTentativeDisplacement).toHaveBeenCalledWith(3, 7);
  });
});
