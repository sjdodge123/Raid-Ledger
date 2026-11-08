/**
 * ROK-2137 — the "Changed in game" rule, the editor-only DTO block, the route
 * field parse and the Adopt body (pure; no DB).
 */
import { BadRequestException } from '@nestjs/common';
import {
  adoptPutBody,
  isChangedInGame,
  parseIngameFieldKey,
  toGameTextDto,
  type GameFieldState,
  isSameReport,
  type GameTextRow,
} from './guild-ingame-game-text.helpers';

const AT = '2026-11-08T20:00:00.000000Z';

const state = (over: Partial<GameFieldState> = {}): GameFieldState => ({
  text: 'Raid at 9',
  reportedAt: AT,
  reportedBy: null,
  acked: false,
  ...over,
});

describe('isChangedInGame', () => {
  it.each<[string, GameFieldState, string | null, boolean]>([
    ['never reported', state({ reportedAt: null, text: null }), 'Hub', false],
    ['report differs, not acked', state(), 'Raid at 8', true],
    ['report equals hub text', state(), 'Raid at 9', false],
    ['report differs but acked (pushed)', state({ acked: true }), 'X', false],
    ['reported empty vs hub text', state({ text: null }), 'Hub', true],
    ['reported empty vs no hub text', state({ text: null }), null, false],
    ['report vs no hub text', state(), null, true],
  ])('%s', (_label, report, hubText, expected) => {
    expect(isChangedInGame(report, hubText)).toBe(expected);
  });
});

describe('toGameTextDto', () => {
  const row: GameTextRow = {
    motd: 'Raid at 9',
    motdReportedAt: AT,
    motdReportedBy: null,
    motdAcked: false,
    info: null,
    infoReportedAt: null,
    infoReportedBy: null,
    infoAcked: false,
  };

  it('carries the exporting character as gameReportedBy only when known', () => {
    const dto = toGameTextDto(
      { ...row, motdReportedBy: 'Thrall' },
      { motd: null, info: null },
    );
    expect(dto.motd?.gameReportedBy).toBe('Thrall');
    expect(
      toGameTextDto(row, { motd: null, info: null }).motd,
    ).not.toHaveProperty('gameReportedBy');
  });

  it('isSameReport compares instants, never-reported is never the same', () => {
    expect(
      isSameReport('2026-11-08T12:00:00.123000Z', '2026-11-08T12:00:00.123Z'),
    ).toBe(true);
    expect(
      isSameReport('2026-11-08T12:00:00.123000Z', '2026-11-08T12:00:01.123Z'),
    ).toBe(false);
    expect(isSameReport(null, '2026-11-08T12:00:00.123Z')).toBe(false);
  });

  it('maps each field; null when never reported; null text → ""', () => {
    expect(toGameTextDto(row, { motd: 'Raid at 8', info: 'x' })).toEqual({
      motd: { gameText: 'Raid at 9', gameReportedAt: AT, changedInGame: true },
      info: null,
    });
    const empty = { ...row, info: null, infoReportedAt: AT };
    expect(toGameTextDto(empty, { motd: null, info: 'x' }).info).toEqual({
      gameText: '',
      gameReportedAt: AT,
      changedInGame: true,
    });
  });

  it('no profile row → both null', () => {
    expect(toGameTextDto(null, { motd: null, info: null })).toEqual({
      motd: null,
      info: null,
    });
  });
});

describe('parseIngameFieldKey', () => {
  it('accepts motd and info', () => {
    expect(parseIngameFieldKey('motd')).toBe('motd');
    expect(parseIngameFieldKey('info')).toBe('info');
  });

  it('400s anything else', () => {
    expect(() => parseIngameFieldKey('ranks')).toThrow(BadRequestException);
  });
});

describe('adoptPutBody', () => {
  it('sends only the adopted field with its current token', () => {
    expect(adoptPutBody('motd', 'Raid at 9', AT)).toEqual({
      motd: 'Raid at 9',
      baseMotdUpdatedAt: AT,
    });
    expect(adoptPutBody('info', null, null)).toEqual({
      info: '',
      baseInfoUpdatedAt: null,
    });
  });
});
