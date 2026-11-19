/**
 * ROK-1813 — pure helpers for the opt-in public guild card: member-count
 * rounding (D6), the https-only apply URL (D7), the base62 slug (D1) and the
 * stored recruitment → public recruitment mapping (D5, `note` dropped — N2).
 */
import { randomBytes } from 'node:crypto';
import {
  PUBLIC_GUILD_CARD_SLUG_LENGTH,
  PublicGuildRecruitmentSchema,
  recruitmentHeadline,
  type PublicGuildRecruitment,
} from '@raid-ledger/contract';
import { parseStoredRecruitment } from '../guild-recruitment.helpers';

/** Below this the card says "Fewer than 10 members" (D6). */
export const PUBLIC_MEMBER_COUNT_FLOOR = 10;

/** 62 characters: A-Z, a-z, 0-9 — matches `PublicGuildCardSlugSchema`. */
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Largest multiple of 62 ≤ 256; bytes at or above it are rejected (no modulo bias). */
const BYTE_LIMIT = 256 - (256 % BASE62.length);

/** n < 10 (or not a finite count) → null; else the nearest 10 (143 → 140, 145 → 150). */
export function roundMemberCount(n: number): number | null {
  if (!Number.isFinite(n) || n < PUBLIC_MEMBER_COUNT_FLOOR) return null;
  return Math.round(n / 10) * 10;
}

/** The URL when it is a valid https URL, else null (http, javascript:, data: …). */
export function safeApplyUrl(u: string | null): string | null {
  if (u === null) return null;
  const parsed = PublicGuildRecruitmentSchema.shape.applyUrl.safeParse(
    u.trim(),
  );
  return parsed.success ? parsed.data : null;
}

/** A fresh 16-char base62 slug from `crypto.randomBytes` (rejection sampling). */
export function generateCardSlug(): string {
  let slug = '';
  while (slug.length < PUBLIC_GUILD_CARD_SLUG_LENGTH) {
    for (const byte of randomBytes(PUBLIC_GUILD_CARD_SLUG_LENGTH)) {
      if (byte >= BYTE_LIMIT) continue;
      slug += BASE62.charAt(byte % BASE62.length);
      if (slug.length === PUBLIC_GUILD_CARD_SLUG_LENGTH) break;
    }
  }
  return slug;
}

/**
 * Stored `guild_profiles.recruitment` jsonb → the public shape. Null,
 * malformed or old-shape → null. Headline derived; notes dropped; a
 * non-https apply URL becomes null.
 */
export function toPublicRecruitment(
  stored: unknown,
): PublicGuildRecruitment | null {
  const r = parseStoredRecruitment(stored);
  if (r === null) return null;
  return {
    state: recruitmentHeadline(r),
    wanted: r.wanted.map((w) => ({
      className: w.className,
      role: w.role,
      state: w.state,
    })),
    applyUrl: safeApplyUrl(r.applyUrl),
  };
}
