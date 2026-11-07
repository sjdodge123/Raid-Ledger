/**
 * Blizzard character URL path segments (realm slug, realmless Forever name).
 * Extracted from blizzard-character.helpers.ts for the 300-line cap.
 */
import { BadRequestException } from '@nestjs/common';
import { buildForeverCharacterSlug } from './forever-character-slug';

/**
 * A path segment that is empty or dots only survives percent-encoding
 * (`encodeURIComponent('..') === '..'`) and fetch normalises it to another
 * Blizzard path with the app's token (tech-debt 4082; 2904 covered slashes).
 */
export function assertNotDotSegment(segment: string, label: string): void {
  if (segment.length === 0 || /^\.+$/.test(segment)) {
    throw new BadRequestException(`${label} is not a valid path segment`);
  }
}

/** Slugify + percent-encode a realm name into a URL path segment. */
export function buildRealmSlug(realm: string): string {
  const slug = realm
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '-')
    .trim();
  assertNotDotSegment(slug, 'Realm');
  return encodeURIComponent(slug);
}

/** Realmless Forever slug; a malformed stored name maps to a 400. */
export function buildRealmlessCharName(name: string): string {
  try {
    return buildForeverCharacterSlug(name);
  } catch (err) {
    if (err instanceof Error) throw new BadRequestException(err.message);
    throw err;
  }
}
