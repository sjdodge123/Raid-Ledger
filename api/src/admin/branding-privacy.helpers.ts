/**
 * ROK-1778: the optional privacy contact email shown on the public /privacy
 * page. Saved through PATCH /admin/branding next to the community name.
 */
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import type { SettingsService } from '../settings/settings.service';

const INVALID_MESSAGE = 'Privacy contact email must be a valid email address';
const PrivacyContactEmailSchema = z.string().email().max(254);

/**
 * Normalise an admin-submitted value: null, '' or whitespace clears the
 * setting (returns null); anything else must be a valid email.
 */
export function parsePrivacyContactEmail(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new BadRequestException(INVALID_MESSAGE);
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = PrivacyContactEmailSchema.safeParse(trimmed);
  if (!parsed.success) throw new BadRequestException(INVALID_MESSAGE);
  return parsed.data;
}

/** Validate and persist (or clear) the privacy contact email. */
export async function savePrivacyContactEmail(
  settings: Pick<SettingsService, 'set' | 'delete'>,
  raw: unknown,
): Promise<void> {
  const email = parsePrivacyContactEmail(raw);
  if (email === null) {
    await settings.delete(SETTING_KEYS.PRIVACY_CONTACT_EMAIL);
    return;
  }
  await settings.set(SETTING_KEYS.PRIVACY_CONTACT_EMAIL, email);
}
