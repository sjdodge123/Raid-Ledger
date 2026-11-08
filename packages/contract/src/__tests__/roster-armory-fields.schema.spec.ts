/**
 * ROK-2133 (Q10) — the additive roster Armory fields: optional `itemLevel`,
 * `spec` and `role` on the members-list row and the roster-claim candidate.
 * Old payloads without them still parse; present values are validated.
 * Runs under the contract workspace's vitest.
 */
import { describe, it, expect } from 'vitest';
import {
  GuildMemberRowSchema,
  RosterClaimCandidateSchema,
} from '../index.js';

const member = {
  memberId: 7,
  name: 'Aldren',
  class: 'Mage',
  level: 60,
  rankIndex: 1,
  rankName: 'Officer',
  effectiveRole: null,
  characterId: null,
  isMain: false,
};

const candidate = {
  memberId: 11,
  name: 'Ashen Vale',
  class: 'Mage',
  level: 60,
  source: 'blizzard' as const,
};

const armory = { itemLevel: 112, spec: 'Frost', role: 'dps' as const };

const schemas = [
  ['GuildMemberRowSchema', GuildMemberRowSchema, member],
  ['RosterClaimCandidateSchema', RosterClaimCandidateSchema, candidate],
] as const;

describe.each(schemas)('%s Armory fields (ROK-2133)', (_name, schema, base) => {
  it('still parses an old payload without them', () => {
    const row = schema.parse(base);
    expect(row.itemLevel).toBeUndefined();
    expect(row.spec).toBeUndefined();
    expect(row.role).toBeUndefined();
  });

  it('accepts item level, spec and role', () => {
    expect(schema.parse({ ...base, ...armory })).toEqual({ ...base, ...armory });
    expect(schema.parse({ ...base, itemLevel: 0 }).itemLevel).toBe(0);
  });

  it.each([
    ['a negative item level', { itemLevel: -1 }],
    ['a fractional item level', { itemLevel: 1.5 }],
    ['a spec over 50 chars', { spec: 'x'.repeat(51) }],
    ['an unknown role', { role: 'flex' }],
  ])('rejects %s', (_label, bad) => {
    expect(schema.safeParse({ ...base, ...bad }).success).toBe(false);
  });
});
