/**
 * Unit tests for mapManagementRow (ROK-313 AC11 surfacing). Verifies the new
 * discordId / kickedAt / bannedAt fields map through to the management DTO as
 * ISO strings (or null), alongside the existing deactivatedAt handling.
 */
import { mapManagementRow, type UserManagementRow } from './users-management.helpers';

const BASE: UserManagementRow = {
  id: 7,
  username: 'Kicked Kevin',
  avatar: null,
  customAvatarUrl: null,
  role: 'member',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

it('surfaces discordId + ISO kickedAt/bannedAt when set', () => {
  const dto = mapManagementRow({
    ...BASE,
    discordId: '123456789',
    kickedAt: new Date('2026-07-01T10:00:00.000Z'),
    bannedAt: new Date('2026-07-02T11:30:00.000Z'),
    deactivatedAt: new Date('2026-07-02T11:30:00.000Z'),
  });
  expect(dto.discordId).toBe('123456789');
  expect(dto.kickedAt).toBe('2026-07-01T10:00:00.000Z');
  expect(dto.bannedAt).toBe('2026-07-02T11:30:00.000Z');
  expect(dto.deactivatedAt).toBe('2026-07-02T11:30:00.000Z');
  expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
});

it('passes null / undefined moderation fields through as null', () => {
  const dto = mapManagementRow({ ...BASE, discordId: null });
  expect(dto.discordId).toBeNull();
  expect(dto.kickedAt).toBeNull();
  expect(dto.bannedAt).toBeNull();
  expect(dto.deactivatedAt).toBeNull();
});

it('accepts pre-stringified ISO timestamps unchanged', () => {
  const dto = mapManagementRow({
    ...BASE,
    createdAt: '2026-01-01T00:00:00.000Z',
    kickedAt: '2026-07-01T10:00:00.000Z',
  });
  expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  expect(dto.kickedAt).toBe('2026-07-01T10:00:00.000Z');
});
