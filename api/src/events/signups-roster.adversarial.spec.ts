/**
 * Adversarial tests for ROK-626: response builder assignedSlot coverage.
 * Tests all assignedSlot values (tank, healer, dps, flex, player, bench)
 * plus undefined/null/empty-string edge cases.
 */
import {
  buildSignupResponseDto,
  buildAnonymousSignupResponseDto,
} from './signups-roster.helpers';

const baseSignup = {
  id: 10,
  eventId: 5,
  userId: 3,
  discordUserId: null,
  discordUsername: null,
  discordAvatarHash: null,
  note: 'test note',
  signedUpAt: new Date('2026-03-01T12:00:00Z'),
  characterId: null,
  confirmationStatus: 'confirmed',
  status: 'signed_up',
  preferredRoles: ['tank', 'healer'],
  attendanceStatus: null,
  attendanceRecordedAt: null,
  roachedOutAt: null,
};

const baseUser = {
  id: 3,
  username: 'warrior123',
  discordId: 'disc-456',
  avatar: 'avatar-hash',
};

const anonSignup = {
  ...baseSignup,
  userId: null,
  discordUserId: 'discord-anon-1',
  discordUsername: 'AnonWarrior',
  discordAvatarHash: 'hash-xyz',
};

describe('buildSignupResponseDto — assignedSlot edge cases', () => {
  it.each(['tank', 'healer', 'dps', 'flex', 'player', 'bench'])(
    'includes assignedSlot when value is %s',
    (slot) => {
      const result = buildSignupResponseDto(
        baseSignup as Parameters<typeof buildSignupResponseDto>[0],
        baseUser as Parameters<typeof buildSignupResponseDto>[1],
        null,
        slot,
      );
      expect(result.assignedSlot).toBe(slot);
    },
  );

  it('omits assignedSlot when not provided', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
    );
    expect(result).not.toHaveProperty('assignedSlot');
  });

  it('omits assignedSlot when undefined is passed', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
      undefined,
    );
    expect(result).not.toHaveProperty('assignedSlot');
  });

  it('omits assignedSlot when empty string is passed', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
      '',
    );
    // empty string is falsy, so spread condition !!'' === false
    expect(result).not.toHaveProperty('assignedSlot');
  });

  it('preserves all other fields when assignedSlot is set', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
      'bench',
    );
    expect(result.id).toBe(10);
    expect(result.eventId).toBe(5);
    expect(result.user.username).toBe('warrior123');
    expect(result.note).toBe('test note');
    expect(result.status).toBe('signed_up');
    expect(result.confirmationStatus).toBe('confirmed');
    expect(result.preferredRoles).toEqual(['tank', 'healer']);
  });

  it('handles missing user gracefully', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      undefined,
      null,
      'dps',
    );
    expect(result.user.id).toBe(0);
    expect(result.user.username).toBe('Unknown');
    expect(result.assignedSlot).toBe('dps');
  });
});

describe('buildAnonymousSignupResponseDto — assignedSlot edge cases', () => {
  it.each(['tank', 'healer', 'dps', 'flex', 'player', 'bench'])(
    'includes assignedSlot when value is %s',
    (slot) => {
      const result = buildAnonymousSignupResponseDto(
        anonSignup as Parameters<typeof buildAnonymousSignupResponseDto>[0],
        slot,
      );
      expect(result.assignedSlot).toBe(slot);
    },
  );

  it('omits assignedSlot when not provided', () => {
    const result = buildAnonymousSignupResponseDto(
      anonSignup as Parameters<typeof buildAnonymousSignupResponseDto>[0],
    );
    expect(result).not.toHaveProperty('assignedSlot');
  });

  it('sets isAnonymous flag', () => {
    const result = buildAnonymousSignupResponseDto(
      anonSignup as Parameters<typeof buildAnonymousSignupResponseDto>[0],
      'bench',
    );
    expect(result.isAnonymous).toBe(true);
    expect(result.discordUserId).toBe('discord-anon-1');
    expect(result.discordUsername).toBe('AnonWarrior');
  });
});
