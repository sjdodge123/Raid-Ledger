/**
 * ROK-2352 §3.3 — WoW hand detail validation (roles 1..3, distinct, strict).
 * DB-backed paths are covered by `wow-lfg-grouping.integration.spec.ts`.
 */
import { BadRequestException } from '@nestjs/common';
import { parseWowHandDetail } from './wow-lfg-detail.helpers';

const CHAR = '00000000-0000-4000-8000-000000000001';

describe('parseWowHandDetail', () => {
  it('accepts 1..3 distinct roles with or without a character', () => {
    expect(parseWowHandDetail({ roles: ['tank'] })).toEqual({ roles: ['tank'] });
    expect(parseWowHandDetail({ roles: ['tank', 'healer', 'dps'], characterId: CHAR })).toEqual({
      roles: ['tank', 'healer', 'dps'],
      characterId: CHAR,
    });
  });

  it.each([
    ['no roles', { roles: [] }],
    ['missing roles', { characterId: CHAR }],
    ['duplicate roles', { roles: ['dps', 'dps'] }],
    ['unknown role', { roles: ['bard'] }],
    ['extra key', { roles: ['dps'], difficulty: 'heroic' }],
    ['bad character id', { roles: ['dps'], characterId: 'nope' }],
    ['not an object', 'tank'],
  ])('rejects %s with a 400', (_label, detail) => {
    expect(() => parseWowHandDetail(detail)).toThrow(BadRequestException);
  });
});
