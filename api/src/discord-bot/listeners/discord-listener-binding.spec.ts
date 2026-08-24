import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { Client } from 'discord.js';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';

/**
 * A real EventEmitter stands in for the discord.js Client so `listenerCount`
 * reports the genuine number of live handlers — a jest.fn() spy could only
 * prove `on` was *called*, not that exactly one handler survives.
 */
function makeFakeClient(): EventEmitter & Client {
  return new EventEmitter() as unknown as EventEmitter & Client;
}

function makeSilentLogger(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

describe('DiscordListenerBinding', () => {
  let logger: Logger;
  let binding: DiscordListenerBinding;

  beforeEach(() => {
    logger = makeSilentLogger();
    binding = new DiscordListenerBinding(logger, 'test listener');
  });

  it('attaches every supplied binding and routes gateway args through', () => {
    const client = makeFakeClient();
    const onInteraction = jest.fn();
    const onVoice = jest.fn();

    binding.attach(client, [
      gatewayBinding('interactionCreate', onInteraction),
      gatewayBinding('voiceStateUpdate', onVoice),
    ]);

    expect(binding.attachedCount).toBe(2);
    client.emit('interactionCreate', { customId: 'pef_schedule:7' });
    client.emit('voiceStateUpdate', { channelId: null }, { channelId: 'v1' });

    expect(onInteraction).toHaveBeenCalledWith({ customId: 'pef_schedule:7' });
    expect(onVoice).toHaveBeenCalledWith(
      { channelId: null },
      { channelId: 'v1' },
    );
  });

  it('detach() removes the handlers and stops delivery', () => {
    const client = makeFakeClient();
    const handler = jest.fn();
    binding.attach(client, [gatewayBinding('interactionCreate', handler)]);

    binding.detach();

    expect(binding.attachedCount).toBe(0);
    expect(client.listenerCount('interactionCreate')).toBe(0);
    client.emit('interactionCreate', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('detach() is a no-op when nothing is attached', () => {
    expect(() => binding.detach()).not.toThrow();
    expect(binding.attachedCount).toBe(0);
  });

  it('survives a client whose removeListener throws', () => {
    const exploding = {
      on: jest.fn(),
      removeListener: jest.fn(() => {
        throw new Error('client destroyed');
      }),
    } as unknown as Client;
    binding.attach(exploding, [gatewayBinding('interactionCreate', jest.fn())]);

    expect(() => binding.detach()).not.toThrow();
    expect(binding.attachedCount).toBe(0);
  });

  describe('attachToClient', () => {
    it('attaches and reports success when a client exists', () => {
      const client = makeFakeClient();
      const attached = binding.attachToClient(client, [
        gatewayBinding('interactionCreate', jest.fn()),
      ]);

      expect(attached).toBe(true);
      expect(client.listenerCount('interactionCreate')).toBe(1);
    });

    it('warns and reports failure when there is no client', () => {
      const attached = binding.attachToClient(null, [
        gatewayBinding('interactionCreate', jest.fn()),
      ]);

      expect(attached).toBe(false);
      expect(binding.attachedCount).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Discord client unavailable'),
      );
    });
  });

  describe('Regression: ROK-1425 — attach lifecycle', () => {
    it('leaves exactly ONE live handler across CONNECTED → DISCONNECTED → CONNECTED', () => {
      const first = makeFakeClient();
      const second = makeFakeClient();
      const handler = jest.fn();

      binding.attach(first, [gatewayBinding('interactionCreate', handler)]);
      binding.detach();
      binding.attach(second, [gatewayBinding('interactionCreate', handler)]);

      // No orphan left on the torn-down client, no stack on the live one.
      expect(first.listenerCount('interactionCreate')).toBe(0);
      expect(second.listenerCount('interactionCreate')).toBe(1);
      expect(binding.attachedCount).toBe(1);
    });

    it('does not stack handlers when CONNECTED fires twice without DISCONNECTED', () => {
      const client = makeFakeClient();
      const handler = jest.fn();

      binding.attach(client, [gatewayBinding('interactionCreate', handler)]);
      binding.attach(client, [gatewayBinding('interactionCreate', handler)]);

      expect(client.listenerCount('interactionCreate')).toBe(1);
      expect(binding.attachedCount).toBe(1);

      client.emit('interactionCreate', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('re-attaching to a NEW client clears the old client, not the new one', () => {
      const destroyed = makeFakeClient();
      const live = makeFakeClient();
      const onDestroyed = jest.fn();
      const onLive = jest.fn();

      binding.attach(destroyed, [
        gatewayBinding('interactionCreate', onDestroyed),
      ]);
      // Reconnect without an intervening DISCONNECTED (the missed-teardown case).
      binding.attach(live, [gatewayBinding('interactionCreate', onLive)]);

      destroyed.emit('interactionCreate', {});
      live.emit('interactionCreate', {});

      expect(onDestroyed).not.toHaveBeenCalled();
      expect(onLive).toHaveBeenCalledTimes(1);
    });

    it('detaches every event of a multi-event binding, not just the first', () => {
      const client = makeFakeClient();
      binding.attach(client, [
        gatewayBinding('interactionCreate', jest.fn()),
        gatewayBinding('voiceStateUpdate', jest.fn()),
      ]);

      binding.detach();

      expect(client.listenerCount('interactionCreate')).toBe(0);
      expect(client.listenerCount('voiceStateUpdate')).toBe(0);
    });
  });
});
