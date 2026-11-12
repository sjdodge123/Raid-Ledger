/** ROK-1871 (ROK-1428 §2.7) — the mirror's channelSource + managedFor meta. */
import type { GuildDiscordMirrorDto } from '@raid-ledger/contract';
import { BadRequestException } from '@nestjs/common';
import { parseRefreshFlag, withChannelMeta } from './guild-discord.helpers';

const OK: GuildDiscordMirrorDto = {
  state: 'ok',
  channel: { id: '1', name: 'valheim', visibility: 'public', url: 'u' },
  messages: [],
  fetchedAt: '2026-10-20T00:00:00.000Z',
};

describe('withChannelMeta', () => {
  it('an ok read carries channelSource + managedFor', () => {
    const managedFor = { gameId: 5, gameName: 'Valheim' };
    expect(withChannelMeta(OK, { source: 'auto', managedFor })).toEqual({
      ...OK,
      channelSource: 'auto',
      managedFor,
    });
  });

  it('a manual, unmanaged channel → channelSource manual, managedFor null', () => {
    expect(withChannelMeta(OK, { source: 'manual', managedFor: null })).toEqual(
      { ...OK, channelSource: 'manual', managedFor: null },
    );
  });

  it('non-ok states are unchanged', () => {
    const gone: GuildDiscordMirrorDto = {
      state: 'gone',
      channelId: '1',
      channelName: null,
    };
    expect(withChannelMeta(gone, { source: 'auto', managedFor: null })).toBe(
      gone,
    );
  });
});

describe('parseRefreshFlag (ROK-2185 ?refresh=1)', () => {
  it.each([
    [undefined, false],
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ])('%p -> %p', (raw, expected) => {
    expect(parseRefreshFlag(raw)).toBe(expected);
  });

  it.each([['yes'], ['2'], [['1', '1']], ['']])(
    'rejects %p with a 400',
    (raw) => {
      expect(() => parseRefreshFlag(raw)).toThrow(BadRequestException);
    },
  );
});
