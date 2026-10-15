import { BadRequestException, ConflictException } from '@nestjs/common';
import { quickPlayGameTakenMessage } from '@raid-ledger/contract';
import {
  bindErrorReply,
  explicitPurposeError,
  parsePurposeOption,
  QP_WITH_SERIES_ERROR,
} from './bind.purpose';

type ParseParam = Parameters<typeof parsePurposeOption>[0];

function withPurpose(value: string | null): ParseParam {
  const options = {
    getString: (name: string) => (name === 'purpose' ? value : null),
  };
  return { options } as unknown as ParseParam;
}

describe('parsePurposeOption (ROK-1768)', () => {
  it('returns null when the option is absent', () => {
    expect(parsePurposeOption(withPurpose(null))).toBeNull();
  });

  it.each(['game-announcements', 'quick-play-announcements'])(
    'returns %s as chosen',
    (value) => {
      expect(parsePurposeOption(withPurpose(value))).toBe(value);
    },
  );

  it('returns null for a value that is not one of the choices', () => {
    expect(parsePurposeOption(withPurpose('general-lobby'))).toBeNull();
  });
});

describe('explicitPurposeError (ROK-1768)', () => {
  const base = { channelType: 'text' as const, gameId: 7, hasSeries: false };

  it('refuses Quick Play scoped to a series before anything else', () => {
    expect(
      explicitPurposeError({
        ...base,
        purpose: 'quick-play-announcements',
        gameId: null,
        hasSeries: true,
      }),
    ).toBe(QP_WITH_SERIES_ERROR);
  });

  it('refuses Quick Play without a game with the classifier sentence', () => {
    expect(
      explicitPurposeError({
        ...base,
        purpose: 'quick-play-announcements',
        gameId: null,
      }),
    ).toBe('A Quick Play Announcements binding must have a game.');
  });

  it('refuses Quick Play on a voice channel', () => {
    expect(
      explicitPurposeError({
        ...base,
        purpose: 'quick-play-announcements',
        channelType: 'voice',
      }),
    ).toMatch(/Quick Play Announcements/);
  });

  it('accepts Quick Play on a text channel with a game', () => {
    expect(
      explicitPurposeError({ ...base, purpose: 'quick-play-announcements' }),
    ).toBeNull();
  });

  it('accepts Announcements on a text channel, with or without a series', () => {
    expect(
      explicitPurposeError({
        ...base,
        purpose: 'game-announcements',
        gameId: null,
        hasSeries: true,
      }),
    ).toBeNull();
  });
});

describe('bindErrorReply (ROK-1768)', () => {
  it('names the channel that already posts Quick Play for a 409', () => {
    const err = new ConflictException({
      message: 'taken',
      code: 'BINDING_QP_GAME_TAKEN',
      field: 'gameId',
      channelId: 'CH_A',
    });
    expect(bindErrorReply(err)).toBe(quickPlayGameTakenMessage('<#CH_A>'));
    expect(bindErrorReply(err)).toContain('<#CH_A>');
  });

  it('passes the first guard sentence of a 400 through', () => {
    const err = new BadRequestException({ errors: ['gameId: nope', 'x'] });
    expect(bindErrorReply(err)).toBe('gameId: nope');
  });

  it('returns null for anything else', () => {
    expect(bindErrorReply(new Error('boom'))).toBeNull();
    expect(bindErrorReply(new ConflictException('plain'))).toBeNull();
  });
});
