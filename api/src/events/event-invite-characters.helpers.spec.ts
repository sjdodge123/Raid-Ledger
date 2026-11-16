/**
 * ROK-2215 A1: pure planning of who gets an invite from a list of character
 * ids, plus the creator/staff gate on the endpoint.
 */
import { ForbiddenException } from '@nestjs/common';
import type { EventResponseDto } from '@raid-ledger/contract';
import {
  assertCanInviteCharacters,
  inviteCharactersAsCaller,
  planCharacterInvites,
  type CharacterInviteDeps,
  type CharacterOwnerRow,
} from './event-invite-characters.helpers';

const CREATOR_ID = 1;
const C_SELF = '00000000-0000-4000-8000-000000000001';
const C_A1 = '00000000-0000-4000-8000-000000000002';
const C_A2 = '00000000-0000-4000-8000-000000000003';
const C_B = '00000000-0000-4000-8000-000000000004';
const C_LOCAL = '00000000-0000-4000-8000-000000000005';
const C_UNLINKED = '00000000-0000-4000-8000-000000000006';
const C_MISSING = '00000000-0000-4000-8000-000000000007';

function row(
  characterId: string,
  characterName: string,
  userId: number,
  discordId: string | null,
): CharacterOwnerRow {
  return {
    characterId,
    characterName,
    userId,
    username: `user${userId}`,
    discordId,
  };
}

const ROWS: CharacterOwnerRow[] = [
  row(C_SELF, 'Selfie', CREATOR_ID, '100000000000000001'),
  row(C_A1, 'Aelin', 2, '100000000000000002'),
  row(C_A2, 'Aelalt', 2, '100000000000000002'),
  row(C_B, 'Brann', 3, '100000000000000003'),
  row(C_LOCAL, 'Corra', 4, 'local:corra@test.local'),
  row(C_UNLINKED, 'Dagny', 5, 'unlinked:123'),
];

describe('planCharacterInvites', () => {
  it('keeps only the first character per owner', () => {
    const plan = planCharacterInvites(ROWS, [C_A1, C_A2], CREATOR_ID);
    expect(plan.targets.map((t) => t.characterId)).toEqual([C_A1]);
    expect(plan.skipped).toEqual([]);
  });

  it('drops the caller own character silently (no target, no skip)', () => {
    const plan = planCharacterInvites(ROWS, [C_SELF, C_B], CREATOR_ID);
    expect(plan.targets.map((t) => t.characterId)).toEqual([C_B]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips local: and unlinked: owners as no_discord with the name', () => {
    const plan = planCharacterInvites(ROWS, [C_LOCAL, C_UNLINKED], CREATOR_ID);
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toEqual([
      { characterId: C_LOCAL, characterName: 'Corra', reason: 'no_discord' },
      { characterId: C_UNLINKED, characterName: 'Dagny', reason: 'no_discord' },
    ]);
  });

  it('skips an owner with no discord id at all as no_discord', () => {
    const rows = [row(C_B, 'Brann', 3, null)];
    const plan = planCharacterInvites(rows, [C_B], CREATOR_ID);
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toEqual([
      { characterId: C_B, characterName: 'Brann', reason: 'no_discord' },
    ]);
  });

  it('reports an unknown id as not_found with a null name', () => {
    const plan = planCharacterInvites(ROWS, [C_MISSING], CREATOR_ID);
    expect(plan.skipped).toEqual([
      { characterId: C_MISSING, characterName: null, reason: 'not_found' },
    ]);
  });

  it('keeps request order and de-duplicates repeated ids', () => {
    const ids = [C_B, C_MISSING, C_A1, C_LOCAL, C_B];
    const plan = planCharacterInvites(ROWS, ids, CREATOR_ID);
    expect(plan.targets).toEqual([
      {
        characterId: C_B,
        characterName: 'Brann',
        userId: 3,
        username: 'user3',
        discordId: '100000000000000003',
      },
      {
        characterId: C_A1,
        characterName: 'Aelin',
        userId: 2,
        username: 'user2',
        discordId: '100000000000000002',
      },
    ]);
    expect(plan.skipped.map((s) => s.characterId)).toEqual([
      C_MISSING,
      C_LOCAL,
    ]);
  });
});

describe('assertCanInviteCharacters', () => {
  const event = { creator: { id: CREATOR_ID } };

  it('allows the event creator', () => {
    expect(() =>
      assertCanInviteCharacters(event, CREATOR_ID, false),
    ).not.toThrow();
  });

  it('allows staff (operator/admin) who did not create the event', () => {
    expect(() => assertCanInviteCharacters(event, 99, true)).not.toThrow();
  });

  it('refuses anyone else with 403', () => {
    expect(() => assertCanInviteCharacters(event, 99, false)).toThrow(
      new ForbiddenException('Only the event creator can invite characters'),
    );
  });
});

describe('inviteCharactersAsCaller', () => {
  it('refuses a non-creator non-staff caller before touching the db', async () => {
    const select = jest.fn();
    const deps = {
      db: { select } as unknown as CharacterInviteDeps['db'],
      notificationService: {} as CharacterInviteDeps['notificationService'],
      eventEmitter: {} as CharacterInviteDeps['eventEmitter'],
      logger: { log: jest.fn() } as unknown as CharacterInviteDeps['logger'],
      findOne: jest
        .fn()
        .mockResolvedValue({ creator: { id: CREATOR_ID } } as EventResponseDto),
    };
    await expect(
      inviteCharactersAsCaller(deps, 7, 99, false, [C_B]),
    ).rejects.toThrow(
      new ForbiddenException('Only the event creator can invite characters'),
    );
    expect(deps.findOne).toHaveBeenCalledWith(7);
    expect(select).not.toHaveBeenCalled();
  });
});
