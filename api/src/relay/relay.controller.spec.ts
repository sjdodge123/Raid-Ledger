import { BadRequestException } from '@nestjs/common';
import { RelayController } from './relay.controller';
import type { RelayService } from './relay.service';

describe('RelayController.updateRelaySettings', () => {
  let updateSettings: jest.Mock;
  let controller: RelayController;

  beforeEach(() => {
    updateSettings = jest.fn().mockResolvedValue(undefined);
    const service = { updateSettings } as unknown as RelayService;
    controller = new RelayController(service);
  });

  it.each([
    ['a file:// relay URL', { relayUrl: 'file:///etc/passwd' }],
    ['a non-URL relay URL', { relayUrl: 'not a url at all' }],
    ['a javascript: relay URL', { relayUrl: 'javascript:alert(1)' }],
    [
      'an over-long relay URL',
      { relayUrl: `https://x.io/${'a'.repeat(2048)}` },
    ],
    ['a non-boolean enabled', { enabled: 'true' }],
    ['an unknown key', { enabled: true, token: 'x' }],
    ['a non-object body', 'enabled=true'],
  ])('rejects %s with 400 and stores nothing', async (_label, body) => {
    await expect(controller.updateRelaySettings(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('stores a valid body exactly once, trimming the URL', async () => {
    await controller.updateRelaySettings({
      enabled: true,
      relayUrl: '  https://relay.example.com/hub  ',
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      enabled: true,
      relayUrl: 'https://relay.example.com/hub',
    });
  });

  it('passes only the keys that were sent', async () => {
    await controller.updateRelaySettings({ enabled: false });
    expect(updateSettings).toHaveBeenCalledWith({ enabled: false });
  });
});
