import type { ActionRowBuilder, ButtonBuilder, Client } from 'discord.js';
import {
  buildDmRows,
  fetchReadyTextChannel,
  toRows,
} from './discord-bot-client-rows.helpers';

const row = (n: number): ActionRowBuilder<ButtonBuilder> =>
  ({ n }) as unknown as ActionRowBuilder<ButtonBuilder>;

describe('toRows (ROK-1728)', () => {
  it('returns [] for undefined', () => {
    expect(toRows(undefined)).toEqual([]);
  });
  it('wraps a single row', () => {
    const r = row(1);
    expect(toRows(r)).toEqual([r]);
  });
  it('copies a row list in order', () => {
    const list = [row(1), row(2)];
    const out = toRows(list);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });
});

describe('buildDmRows', () => {
  it('puts extra rows before the primary row', () => {
    const [a, b, p] = [row(1), row(2), row(3)];
    expect(buildDmRows(p, [a, b])).toEqual([a, b, p]);
  });
  it('returns [] when neither is given', () => {
    expect(buildDmRows(undefined, undefined)).toEqual([]);
  });
});

describe('fetchReadyTextChannel', () => {
  const clientWith = (channel: unknown): Client =>
    ({
      isReady: () => true,
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    }) as unknown as Client;

  it('throws when the client is not connected', async () => {
    await expect(fetchReadyTextChannel(null, 'c1')).rejects.toThrow(
      'Discord bot is not connected',
    );
  });
  it('throws when the channel cannot send', async () => {
    await expect(fetchReadyTextChannel(clientWith({}), 'c1')).rejects.toThrow(
      'Channel c1 not found or not a text channel',
    );
  });
  it('returns a sendable channel', async () => {
    const channel = { send: jest.fn() };
    await expect(
      fetchReadyTextChannel(clientWith(channel), 'c1'),
    ).resolves.toBe(channel);
  });
});
