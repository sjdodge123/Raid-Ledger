/**
 * ROK-2215 — POST /events/:id/invite-characters at the controller: the body
 * is validated against the strict contract schema (400 before the service),
 * and a valid body reaches the service with the caller and role → isAdmin.
 */
import { Test } from '@nestjs/testing';
import type { UserRole } from '@raid-ledger/contract';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SignupsService } from './signups.service';
import { ShareService } from './share.service';
import { EventGuildTagService } from './event-guild-tag.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { LfgEventConvertService } from '../lfg/lfg-event-convert.service';
import type { AuthenticatedRequest } from '../auth/types';

const C1 = '00000000-0000-4000-8000-000000000001';
const RESULT = { invited: [], skipped: [] };

let controller: EventsController;
let inviteCharacters: jest.Mock;

const asRole = (role: UserRole) =>
  ({ user: { id: 5, role } }) as AuthenticatedRequest;

beforeEach(async () => {
  inviteCharacters = jest.fn().mockResolvedValue(RESULT);
  const module = await Test.createTestingModule({
    controllers: [EventsController],
    providers: [
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: EventsService, useValue: { inviteCharacters } },
      { provide: SignupsService, useValue: {} },
      { provide: ShareService, useValue: {} },
      { provide: ActivityLogService, useValue: {} },
      { provide: LfgEventConvertService, useValue: {} },
      { provide: EventGuildTagService, useValue: {} },
    ],
  }).compile();
  controller = module.get(EventsController);
});

describe('POST /events/:id/invite-characters — body validation (ROK-2215)', () => {
  const six = Array.from(
    { length: 6 },
    (_, i) => `00000000-0000-4000-8000-00000000001${i}`,
  );
  it.each([
    ['a missing body', undefined],
    ['an empty list', { characterIds: [] }],
    ['more than five ids', { characterIds: six }],
    ['a non-uuid id', { characterIds: ['abc'] }],
    ['an unknown key', { characterIds: [C1], extra: 1 }],
  ])('rejects %s with 400', async (_label, body) => {
    await expect(
      controller.inviteCharacters(7, asRole('member'), body),
    ).rejects.toMatchObject({ status: 400 });
    expect(inviteCharacters).not.toHaveBeenCalled();
  });
});

describe('POST /events/:id/invite-characters — delegation (ROK-2215)', () => {
  it.each([
    ['member', false],
    ['operator', true],
    ['admin', true],
  ] as const)('passes role %s as isAdmin=%s', async (role, isAdmin) => {
    await expect(
      controller.inviteCharacters(7, asRole(role), { characterIds: [C1] }),
    ).resolves.toEqual(RESULT);
    expect(inviteCharacters).toHaveBeenCalledWith(7, { id: 5, isAdmin }, [C1]);
  });
});
