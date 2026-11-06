/**
 * Character-preview input rules (ROK-1722).
 *
 * WoW: Forever is realmless: the preview takes a two-part name and no realm.
 * Every other variant still needs a realm.
 */
import { BadRequestException } from '@nestjs/common';
import { WowForeverNameSchema } from '@raid-ledger/contract';
import type { WowGameVariant } from '@raid-ledger/contract';

/** The name + realm the preview asks Blizzard for. */
export interface PreviewTarget {
  name: string;
  realm: string | null;
}

/**
 * Validate the preview query for its variant.
 * @throws BadRequestException "Enter a first and second name" for a Forever
 *   name that is not two parts, or "Realm is required" for any other variant.
 */
export function resolvePreviewTarget(
  variant: WowGameVariant,
  name: string,
  realm: string | undefined,
): PreviewTarget {
  if (variant === 'wow_forever') {
    const parsed = WowForeverNameSchema.safeParse(name);
    if (!parsed.success)
      throw new BadRequestException('Enter a first and second name');
    return { name: parsed.data, realm: realm?.trim() || null };
  }
  const trimmedRealm = realm?.trim();
  if (!trimmedRealm) throw new BadRequestException('Realm is required');
  return { name: name.trim(), realm: trimmedRealm };
}
