import { HttpStatus } from '@nestjs/common';
import { AddonImportError, addonImportStatus } from './addon-import.errors';

describe('addonImportStatus', () => {
  it.each([
    ['CHARACTER_MOVED', HttpStatus.CONFLICT],
    ['TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE],
    ['RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
    ['BAD_HEADER', HttpStatus.UNPROCESSABLE_ENTITY],
  ] as const)('%s answers HTTP %i', (code, status) => {
    expect(addonImportStatus(code)).toBe(status);
  });

  it('a CHARACTER_MOVED error carries 409 and its code in the body (ROK-2159)', () => {
    const err = new AddonImportError('CHARACTER_MOVED');
    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err.getResponse()).toMatchObject({ code: 'CHARACTER_MOVED' });
  });
});
