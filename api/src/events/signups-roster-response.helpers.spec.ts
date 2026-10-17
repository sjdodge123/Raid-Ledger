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
  runningLateAt: null,
  lateMinutes: null,
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
      baseSignup,
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
      'bench',
    );
    expect(result.assignedSlot).toBe('bench');
  });

  it('should not include assignedSlot when not provided', () => {
    const result = buildSignupResponseDto(
      baseSignup,
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
    const result = buildAnonymousSignupResponseDto(anonSignup, 'bench');
    expect(result.assignedSlot).toBe('bench');
  });

  it('should not include assignedSlot when not provided', () => {
    const result = buildAnonymousSignupResponseDto(anonSignup);
    expect(result.assignedSlot).toBeUndefined();
  });
});

describe('running-late fields in signup response DTOs (ROK-1379 follow-up)', () => {
  const lateAt = new Date('2026-07-15T00:22:09.000Z');

  it('maps runningLateAt/lateMinutes when set (registered)', () => {
    const result = buildSignupResponseDto(
      { ...baseSignup, runningLateAt: lateAt, lateMinutes: 15 },
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
    );
    expect(result.runningLate).toBe(true);
    expect(result.runningLateAt).toBe(lateAt.toISOString());
    expect(result.lateMinutes).toBe(15);
  });

  it('reports not-late when runningLateAt is null (registered)', () => {
    const result = buildSignupResponseDto(
      baseSignup,
      baseUser as Parameters<typeof buildSignupResponseDto>[1],
      null,
    );
    expect(result.runningLate).toBe(false);
    expect(result.runningLateAt).toBeNull();
    expect(result.lateMinutes).toBeNull();
  });

  it('maps running-late fields for anonymous signups', () => {
    const anonSignup = {
      ...baseSignup,
      userId: null,
      discordUserId: 'discord-123',
      discordUsername: 'AnonUser',
      discordAvatarHash: 'hash-abc',
      runningLateAt: lateAt,
    };
    const result = buildAnonymousSignupResponseDto(anonSignup);
    expect(result.runningLate).toBe(true);
    expect(result.runningLateAt).toBe(lateAt.toISOString());
    expect(result.lateMinutes).toBeNull();
  });
});
