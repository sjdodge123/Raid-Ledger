/**
 * Unit tests for display-name helpers (ROK-1116).
 *
 * The helpers centralize the `displayName ?? username` fallback so that the
 * literal string "Unknown" only appears at edges where the user row is
 * genuinely missing (orphan / hard-deleted references). See spec
 * `planning-artifacts/specs/ROK-1116.md`.
 */
import { resolveDisplayName, displayNameSql } from './display-name.helpers';
import * as schema from '../drizzle/schema';

describe('resolveDisplayName', () => {
  it('returns displayName when present', () => {
    expect(
      resolveDisplayName({ displayName: 'Alice', username: 'alice123' }),
    ).toBe('Alice');
  });

  it('falls back to username when displayName is null', () => {
    expect(
      resolveDisplayName({ displayName: null, username: 'alice123' }),
    ).toBe('alice123');
  });

  it('falls back to username when displayName is undefined', () => {
    expect(
      resolveDisplayName({ displayName: undefined, username: 'alice123' }),
    ).toBe('alice123');
  });

  it('falls back to username when displayName is empty string', () => {
    // Mirrors the existing identity-panel.tsx pattern (`||` not `??`) so empty
    // strings are treated as "no displayName chosen".
    expect(resolveDisplayName({ displayName: '', username: 'alice123' })).toBe(
      'alice123',
    );
  });

  it('returns username unchanged for live user record', () => {
    expect(resolveDisplayName({ displayName: null, username: 'bob' })).toBe(
      'bob',
    );
  });
});

describe('displayNameSql', () => {
  it('returns a non-null Drizzle SQL chunk for the users table', () => {
    const chunk = displayNameSql(schema.users);
    expect(chunk).toBeDefined();
    expect(chunk).not.toBeNull();
    // Drizzle SQL objects expose `.queryChunks` — smoke check that we got one
    // back rather than a primitive.
    expect(typeof chunk).toBe('object');
  });
});
