import { randomInt } from 'node:crypto';
import { generateInviteCode } from './pugs.helpers';

jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});
const mockRandomInt = jest.mocked(randomInt);

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz2345679';

describe('generateInviteCode (ROK-1757)', () => {
  it('emits 8 chars drawn only from the invite alphabet', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateInviteCode()).toMatch(/^[a-hjkmnp-z2-79]{8}$/);
    }
  });

  it('draws each char with an unbiased randomInt over the alphabet length', () => {
    mockRandomInt.mockClear();
    generateInviteCode();
    expect(mockRandomInt).toHaveBeenCalledTimes(8);
    expect(mockRandomInt).toHaveBeenCalledWith(ALPHABET.length);
  });
});
