/**
 * Unit tests for ROK-626: assignedSlot in signup response DTOs.
 */
import {
  buildSignupResponseDto,
  buildAnonymousSignupResponseDto,
} from './signups-roster.helpers';

const baseSignup = {
  id: 1,
  eventId: 1,
  userId: 1,
  discordUserId: null,
  discordUsername: null,
  discordAvatarHash: null,
  note: null,
  signedUpAt: new Date('2026-01-01'),
  characterId: null,
  confirmationStatus: 'pending',
  status: 'signed_up',
  preferredRoles: null,
  attendanceStatus: null,
  attendanceRecordedAt: null,
  roachedOutAt: null,
};

const baseUser = {
  id: 1,
  username: 'testuser',
  discordId: '123',
  avatar: null,
};

describe('buildSignupResponseDto — assignedSlot (ROK-626)', () => {
  it('should include assignedSlot when provided', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
      'bench',
    );
    expect(result.assignedSlot).toBe('bench');
  });

  it('should not include assignedSlot when not provided', () => {
    const result = buildSignupResponseDto(
      baseSignup as Parameters<typeof buildSignupResponseDto>[0],
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
    );
    expect(result.assignedSlot).toBeUndefined();
  });
});

describe('buildAnonymousSignupResponseDto — assignedSlot (ROK-626)', () => {
  const anonSignup = {
    ...baseSignup,
    userId: null,
    discordUserId: 'discord-123',
    discordUsername: 'AnonUser',
    discordAvatarHash: 'hash-abc',
  };

  it('should include assignedSlot when provided', () => {
    const result = buildAnonymousSignupResponseDto(
      anonSignup as Parameters<typeof buildAnonymousSignupResponseDto>[0],
      'bench',
    );
    expect(result.assignedSlot).toBe('bench');
  });

  it('should not include assignedSlot when not provided', () => {
    const result = buildAnonymousSignupResponseDto(
      anonSignup as Parameters<typeof buildAnonymousSignupResponseDto>[0],
    );
    expect(result.assignedSlot).toBeUndefined();
  });
});
