/**
 * ROK-1778: privacy contact email validation + persistence for
 * PATCH /admin/branding.
 */
import { BadRequestException } from '@nestjs/common';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import {
  parsePrivacyContactEmail,
  savePrivacyContactEmail,
} from './branding-privacy.helpers';

function makeSettings() {
  return {
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

describe('parsePrivacyContactEmail (ROK-1778)', () => {
  it('trims and returns a valid email', () => {
    expect(parsePrivacyContactEmail('  privacy@guild.example  ')).toBe(
      'privacy@guild.example',
    );
  });

  it.each([null, '', '   '])('treats %p as "clear" (null)', (raw) => {
    expect(parsePrivacyContactEmail(raw)).toBeNull();
  });

  it.each(['not-an-email', 'a@', 42, {}])('rejects %p with a 400', (raw) => {
    expect(() => parsePrivacyContactEmail(raw)).toThrow(
      new BadRequestException(
        'Privacy contact email must be a valid email address',
      ),
    );
  });
});

describe('savePrivacyContactEmail (ROK-1778)', () => {
  it('stores a valid email under the privacy_contact_email key', async () => {
    const settings = makeSettings();
    await savePrivacyContactEmail(settings, 'privacy@guild.example');
    expect(settings.set).toHaveBeenCalledWith(
      SETTING_KEYS.PRIVACY_CONTACT_EMAIL,
      'privacy@guild.example',
    );
    expect(settings.delete).not.toHaveBeenCalled();
  });

  it('deletes the setting when the value is empty', async () => {
    const settings = makeSettings();
    await savePrivacyContactEmail(settings, '');
    expect(settings.delete).toHaveBeenCalledWith(
      SETTING_KEYS.PRIVACY_CONTACT_EMAIL,
    );
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('writes nothing when the value is invalid', async () => {
    const settings = makeSettings();
    await expect(
      savePrivacyContactEmail(settings, 'nope'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.set).not.toHaveBeenCalled();
    expect(settings.delete).not.toHaveBeenCalled();
  });
});
