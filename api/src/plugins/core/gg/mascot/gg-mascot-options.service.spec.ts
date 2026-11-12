/**
 * ROK-2187 — picker options: one Discord fetch per 60 s, 503 when the bot is
 * offline, and Discord's 429 `retry_after` honoured (stale cache or 429).
 */
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { GgMascotOptionsDto } from '@raid-ledger/contract';
import {
  GG_MASCOT_OPTIONS_TTL_MS,
  GgMascotExpressionSource,
  GgMascotOptionsService,
  retryAfterMs,
} from './gg-mascot-options.service';

class FakeSource extends GgMascotExpressionSource {
  fetchExpressions = jest.fn<Promise<GgMascotOptionsDto | null>, []>();
}

const OPTIONS: GgMascotOptionsDto = {
  emojis: [{ id: '1', name: 'wololo', animated: false, previewUrl: 'https://cdn.discordapp.com/emojis/1.webp' }],
  sounds: [{ id: '2', name: 'Wololo', volume: 0.5, available: true, emojiName: null }],
};

function build(): { svc: GgMascotOptionsService; fetchExpressions: jest.Mock } {
  const source = new FakeSource();
  source.fetchExpressions.mockResolvedValue(OPTIONS);
  return { svc: new GgMascotOptionsService(source), fetchExpressions: source.fetchExpressions };
}

describe('GgMascotOptionsService', () => {
  it('calls Discord once per 60 s window', async () => {
    const { svc, fetchExpressions } = build();
    await svc.getOptions(1_000);
    await svc.getOptions(1_000 + GG_MASCOT_OPTIONS_TTL_MS - 1);
    expect(fetchExpressions).toHaveBeenCalledTimes(1);
    await svc.getOptions(1_000 + GG_MASCOT_OPTIONS_TTL_MS);
    expect(fetchExpressions).toHaveBeenCalledTimes(2);
  });

  it('503s while the bot is offline', async () => {
    const { svc, fetchExpressions } = build();
    fetchExpressions.mockResolvedValueOnce(null);
    await expect(svc.getOptions(0)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('on a 429 with no cache answers 429 and does not call Discord until retry_after passes', async () => {
    const { svc, fetchExpressions } = build();
    fetchExpressions.mockRejectedValueOnce({ status: 429, rawError: { retry_after: 3 } });
    await expect(svc.getOptions(0)).rejects.toMatchObject({ status: 429 });
    await expect(svc.getOptions(2_999)).rejects.toBeInstanceOf(HttpException);
    expect(fetchExpressions).toHaveBeenCalledTimes(1);
    await expect(svc.getOptions(3_000)).resolves.toEqual(OPTIONS);
  });

  it('on a 429 with a stale cache serves the stale list', async () => {
    const { svc, fetchExpressions } = build();
    await svc.getOptions(0);
    fetchExpressions.mockRejectedValueOnce({ retryAfter: 5_000 });
    await expect(svc.getOptions(GG_MASCOT_OPTIONS_TTL_MS)).resolves.toEqual(OPTIONS);
  });

  it('rethrows any non-rate-limit error', async () => {
    const { svc, fetchExpressions } = build();
    fetchExpressions.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.getOptions(0)).rejects.toThrow('boom');
  });
});

describe('retryAfterMs', () => {
  it('reads RateLimitError ms, DiscordAPIError seconds, and ignores other errors', () => {
    expect(retryAfterMs({ retryAfter: 1200 })).toBe(1200);
    expect(retryAfterMs({ status: 429, rawError: { retry_after: 1.5 } })).toBe(1500);
    expect(retryAfterMs({ status: 500 })).toBeNull();
    expect(retryAfterMs('nope')).toBeNull();
  });
});
