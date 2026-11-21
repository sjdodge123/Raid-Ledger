import { CalendarReconnectNudgeListener } from './calendar-reconnect-nudge.listener';
import * as helpers from './calendar-reconnect-nudge.helpers';
import type { NotificationService } from './notification.service';
import type { SettingsService } from '../settings/settings.service';

function setup(opts: { syncOn: boolean }) {
  const create = jest.fn().mockResolvedValue({ id: 'n1' });
  const settings = {
    get: jest.fn().mockResolvedValue(opts.syncOn ? 'true' : 'false'),
  };
  const listener = new CalendarReconnectNudgeListener(
    {} as never,
    { create } as unknown as NotificationService,
    settings as unknown as SettingsService,
  );
  return { listener, create };
}

describe('CalendarReconnectNudgeListener (ROK-1866)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('claims the episode and creates the nudge', async () => {
    const claim = jest
      .spyOn(helpers, 'claimReconnectNudge')
      .mockResolvedValue({ userId: 7, provider: 'microsoft' });
    const { listener, create } = setup({ syncOn: true });
    await expect(listener.handle({ connectionId: 3 })).resolves.toBe(true);
    expect(claim).toHaveBeenCalledWith(expect.anything(), 3);
    expect(create).toHaveBeenCalledWith(
      helpers.buildReconnectNudgeInput({ userId: 7, provider: 'microsoft' }, 3),
    );
  });

  it('sends nothing when the episode is already claimed', async () => {
    jest.spyOn(helpers, 'claimReconnectNudge').mockResolvedValue(null);
    const { listener, create } = setup({ syncOn: true });
    await expect(listener.handle({ connectionId: 3 })).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('neither claims nor sends while calendar sync is off (D6)', async () => {
    const claim = jest.spyOn(helpers, 'claimReconnectNudge');
    const { listener, create } = setup({ syncOn: false });
    await expect(listener.handle({ connectionId: 3 })).resolves.toBe(false);
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('never rejects when the claim throws', async () => {
    jest
      .spyOn(helpers, 'claimReconnectNudge')
      .mockRejectedValue(new Error('db down'));
    const { listener } = setup({ syncOn: true });
    await expect(listener.handle({ connectionId: 3 })).resolves.toBe(false);
  });
});
