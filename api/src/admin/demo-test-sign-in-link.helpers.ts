/**
 * Pure helpers for `POST /admin/test/sign-in-link` (agent UI verification).
 *
 * Input parsing and the same-origin `path` guard live here so the controller
 * stays a thin wire and the rules are unit-testable without Nest.
 */
import { BadRequestException } from '@nestjs/common';

/** Magic-link JWT lifetime — mirrors `MagicLinkService.generateLink` ('15m'). */
export const SIGN_IN_LINK_TTL_SECONDS = 900;

export type SignInLinkTarget =
  | { kind: 'id'; userId: number; path: string }
  | { kind: 'username'; username: string; path: string };

export interface SignInLinkResponse {
  url: string;
  userId: number;
  expiresInSeconds: typeof SIGN_IN_LINK_TTL_SECONDS;
}

interface RawBody {
  userId?: unknown;
  username?: unknown;
  path?: unknown;
}

/**
 * A same-origin absolute path: one leading `/`, never `//` (protocol-relative),
 * no backslash (browsers treat `/\host` as `//host`), no scheme, no whitespace
 * or control characters, and no `#` (the fragment carries the token).
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\\') || path.includes('#')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

function parsePath(raw: unknown): string {
  if (raw === undefined) return '/';
  if (typeof raw !== 'string' || !isSafeRelativePath(raw)) {
    throw new BadRequestException(
      'path must be a same-origin absolute path starting with a single "/"',
    );
  }
  return raw;
}

/** Validate the body: exactly one of userId / username, plus a safe path. */
export function parseSignInLinkBody(body: unknown): SignInLinkTarget {
  const raw = (body ?? {}) as RawBody;
  const hasId = raw.userId !== undefined && raw.userId !== null;
  const hasName = raw.username !== undefined && raw.username !== null;
  if (hasId === hasName) {
    throw new BadRequestException('Provide exactly one of userId or username');
  }
  const path = parsePath(raw.path);
  if (hasId) {
    const userId = raw.userId;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) {
      throw new BadRequestException('userId must be a positive integer');
    }
    return { kind: 'id', userId, path };
  }
  const username = raw.username;
  if (typeof username !== 'string' || username.trim() === '') {
    throw new BadRequestException('username must be a non-empty string');
  }
  return { kind: 'username', username, path };
}

/**
 * The web client's base URL, from the same env vars the Discord magic-link
 * callers read (`event-create.command.ts`). `null` when unset or `'auto'`.
 */
export function resolveClientUrl(): string | null {
  const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN || null;
  if (!clientUrl || clientUrl === 'auto') return null;
  return clientUrl;
}

/** Belt-and-braces: the built link must stay on the client's origin. */
export function isSameOrigin(url: string, clientUrl: string): boolean {
  return new URL(url).origin === new URL(clientUrl).origin;
}
