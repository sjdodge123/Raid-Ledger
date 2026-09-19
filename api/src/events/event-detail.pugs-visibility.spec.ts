/**
 * ROK-1626 — what the public event-detail bundle says about PUG slots.
 *
 * `GET /events/:id/detail` is deliberately public (`OptionalJwtGuard`), and it
 * embeds the same list `GET /events/:id/pugs` serves. A logged-out viewer still
 * sees that a slot exists; the member-only fields are blanked.
 */
import type { PugSlotResponseDto } from '@raid-ledger/contract';
import { EventDetailService } from './event-detail.service';

jest.mock('./voice-channel-resolver.helpers', () => ({
  resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock('./event-conflict-enrich.helpers', () => ({
  enrichEventWithConflicts: jest.fn((event: unknown) => Promise.resolve(event)),
}));

const PUG: PugSlotResponseDto = {
  id: '3f0e7f0a-7d0f-4a55-9d53-1f4b8d2c9a11',
  eventId: 7,
  discordUsername: 'guest',
  discordUserId: '123456789012345678',
  discordAvatarHash: 'abc',
  role: 'dps',
  class: null,
  spec: null,
  notes: null,
  status: 'pending',
  serverInviteUrl: 'https://discord.gg/example',
  inviteCode: 'CODE1234',
  claimedByUserId: null,
  createdBy: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function buildService(): EventDetailService {
  const events = { findOne: jest.fn().mockResolvedValue({ id: 7 }) };
  const signups = {
    getRoster: jest.fn().mockResolvedValue({}),
    getRosterWithAssignments: jest.fn().mockResolvedValue({}),
  };
  const pugs = { findAll: jest.fn().mockResolvedValue({ pugs: [PUG] }) };
  return new EventDetailService(
    {} as never,
    events as never,
    signups as never,
    pugs as never,
    {} as never,
    {} as never,
  );
}

describe('EventDetailService — PUG slot visibility (ROK-1626)', () => {
  it('blanks the member-only fields for a logged-out viewer', async () => {
    const { pugs } = await buildService().findDetail(7, null);

    expect(pugs).toHaveLength(1);
    expect(pugs[0].inviteCode).toBeNull();
    expect(pugs[0].serverInviteUrl).toBeNull();
    expect(pugs[0].discordUserId).toBeNull();
  });

  it('still shows a logged-out viewer that the slot exists', async () => {
    const { pugs } = await buildService().findDetail(7, null);

    expect(pugs[0]).toMatchObject({
      id: PUG.id,
      discordUsername: 'guest',
      role: 'dps',
      status: 'pending',
    });
  });

  it('leaves the slot untouched for a logged-in member', async () => {
    const { pugs } = await buildService().findDetail(7, 42);

    expect(pugs[0]).toEqual(PUG);
  });
});
