import { createHash } from 'node:crypto';

/**
 * ROK-1592 (spec §5 "Our id"): the id stamped on every Raid Ledger copy in an
 * external calendar — `rl:<instanceId>:<eventId>:<userId>`. `instanceId` is
 * the first 12 hex of sha256(client URL host), so two self-hosted
 * communities writing to one Google account see each other's copies as
 * foreign busy time. ROK-1596 writes it; ROK-1593 drops our own on read.
 */
const COPY_ID = /^rl:([0-9a-f]{12}):([1-9]\d{0,15}):([1-9]\d{0,15})$/;
const INSTANCE_ID = /^[0-9a-f]{12}$/;

export interface CopyIdParts {
  instanceId: string;
  eventId: number;
  userId: number;
}

/** First 12 hex of sha256(lower-cased host, port included when present). */
export function deriveInstanceId(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (!normalized) throw new Error('instance host is empty');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function isPositiveId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Build a copy id. Throws on a malformed instance id or a non-positive id. */
export function buildCopyId(parts: CopyIdParts): string {
  if (!INSTANCE_ID.test(parts.instanceId))
    throw new Error('instanceId must be 12 lower-case hex characters');
  if (!isPositiveId(parts.eventId) || !isPositiveId(parts.userId))
    throw new Error('eventId and userId must be positive integers');
  return `rl:${parts.instanceId}:${parts.eventId}:${parts.userId}`;
}

/** Decode any instance's copy id; null when it is not one. */
export function decodeCopyId(raw: unknown): CopyIdParts | null {
  if (typeof raw !== 'string') return null;
  const m = COPY_ID.exec(raw);
  const instanceId = m?.[1];
  if (!m || !instanceId) return null;
  const eventId = Number(m[2]);
  const userId = Number(m[3]);
  if (!isPositiveId(eventId) || !isPositiveId(userId)) return null;
  return { instanceId, eventId, userId };
}

/** Decode a copy id written by THIS instance; a foreign instance → null. */
export function parseCopyId(
  raw: unknown,
  instanceId: string,
): { eventId: number; userId: number } | null {
  const parts = decodeCopyId(raw);
  if (!parts || parts.instanceId !== instanceId) return null;
  return { eventId: parts.eventId, userId: parts.userId };
}
