import { and, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import type {
  AddonErrorCharacterDto,
  AddonErrorMemberDto,
  AddonErrorsFiltersDto,
} from '@raid-ledger/contract';
import { escapeLikePattern } from '../../../common/search.util';
import { wowAddonErrorRecords as t } from '../../../drizzle/schema';

/**
 * ROK-2099 (S3) — SQL pieces for the admin addon-error reads. A group's
 * signature is `sha256(addon || '\n' || message)` in hex, computed by
 * Postgres so the list and the detail lookup cannot disagree.
 */
export const signatureSql = sql<string>`encode(sha256(convert_to(${t.addon} || chr(10) || ${t.message}, 'UTF8')), 'hex')`;

/** WHERE clause for the shared filters (undefined = no filter). */
export function addonErrorsWhere(f: AddonErrorsFiltersDto): SQL | undefined {
  const parts: SQL[] = [];
  if (f.addon !== undefined) parts.push(eq(t.addon, f.addon));
  if (f.userId !== undefined) parts.push(eq(t.userId, f.userId));
  if (f.since !== undefined) {
    parts.push(gte(t.lastSeenAt, new Date(f.since)));
  }
  if (f.q !== undefined) {
    const pattern = `%${escapeLikePattern(f.q)}%`;
    const match = or(ilike(t.addon, pattern), ilike(t.message, pattern));
    if (match) parts.push(match);
  }
  return parts.length > 0 ? and(...parts) : undefined;
}

/** Read a `jsonb_agg(...)::text` cell as an array of objects. */
function parseJsonArray(value: unknown): Record<string, unknown>[] {
  if (typeof value !== 'string') return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (v): v is Record<string, unknown> => typeof v === 'object' && v !== null,
  );
}

/** Distinct uploaders of a group, sorted by username. */
export function toMembers(value: unknown): AddonErrorMemberDto[] {
  return parseJsonArray(value)
    .map((m) => ({
      userId: Number(m['userId']),
      username: String(m['username'] ?? ''),
    }))
    .sort(
      (a, b) => a.username.localeCompare(b.username) || a.userId - b.userId,
    );
}

/** Distinct reporting characters of a group, sorted by name then realm. */
export function toCharacters(value: unknown): AddonErrorCharacterDto[] {
  return parseJsonArray(value)
    .map((c) => ({
      name: String(c['name'] ?? ''),
      realm: typeof c['realm'] === 'string' ? c['realm'] : null,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.realm ?? '').localeCompare(b.realm ?? ''),
    );
}
