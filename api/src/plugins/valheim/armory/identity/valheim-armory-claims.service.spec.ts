/**
 * ROK-1835 L3 — member claim + admin assign/unassign outcomes against a
 * mocked repository: 404 / 409 / 400 mapping and the audit row each writes.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import type { ValheimIdentityRepository } from './valheim-identity.repository';
import { ValheimArmoryClaimsService } from './valheim-armory-claims.service';

const tx = {} as ValheimLinkTx;
const at = new Date('2026-10-18T10:00:00Z');

function build() {
  const repo = {
    claimIfUnclaimed: jest.fn().mockResolvedValue(true),
    profileExists: jest.fn().mockResolvedValue(true),
    lockOwner: jest.fn().mockResolvedValue({ claimedBy: null }),
    isActiveUser: jest.fn().mockResolvedValue(true),
    setOwner: jest.fn().mockResolvedValue(undefined),
    listEvents: jest.fn().mockResolvedValue([]),
    findUsers: jest.fn().mockResolvedValue([]),
    insertEvents: jest.fn((_t: unknown, rows: Record<string, unknown>[]) =>
      Promise.resolve(rows.map((r) => ({ id: 1, createdAt: at, ...r }))),
    ),
    transaction: jest.fn((fn: (t: ValheimLinkTx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const svc = new ValheimArmoryClaimsService(
    repo as unknown as ValheimIdentityRepository,
  );
  return { repo, svc };
}

describe('ValheimArmoryClaimsService.claim', () => {
  it('claims an unclaimed character and returns the claim audit row', async () => {
    const { svc } = build();
    await expect(svc.claim(7, 3)).resolves.toEqual({
      id: 1,
      profileId: 7,
      action: 'claim',
      fromUserId: null,
      toUserId: 3,
      actorUserId: 3,
      createdAt: at.toISOString(),
    });
  });

  it('409 when the character is already claimed', async () => {
    const { repo, svc } = build();
    repo.claimIfUnclaimed.mockResolvedValue(false);
    await expect(svc.claim(7, 3)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insertEvents).not.toHaveBeenCalled();
  });

  it('404 when the character does not exist', async () => {
    const { repo, svc } = build();
    repo.claimIfUnclaimed.mockResolvedValue(false);
    repo.profileExists.mockResolvedValue(false);
    await expect(svc.claim(7, 3)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ValheimArmoryClaimsService.assign', () => {
  it('admin_assign over an existing owner records from/to/actor', async () => {
    const { repo, svc } = build();
    repo.lockOwner.mockResolvedValue({ claimedBy: 4 });
    const ev = await svc.assign(7, 1, 5);
    expect(repo.setOwner).toHaveBeenCalledWith(tx, 7, 5);
    expect(ev).toMatchObject({
      action: 'admin_assign',
      fromUserId: 4,
      toUserId: 5,
      actorUserId: 1,
    });
  });

  it('admin_unassign clears the owner', async () => {
    const { repo, svc } = build();
    repo.lockOwner.mockResolvedValue({ claimedBy: 4 });
    const ev = await svc.assign(7, 1, null);
    expect(repo.setOwner).toHaveBeenCalledWith(tx, 7, null);
    expect(repo.isActiveUser).not.toHaveBeenCalled();
    expect(ev).toMatchObject({ action: 'admin_unassign', fromUserId: 4 });
  });

  it('400 for a missing or deactivated target user', async () => {
    const { repo, svc } = build();
    repo.isActiveUser.mockResolvedValue(false);
    await expect(svc.assign(7, 1, 5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.setOwner).not.toHaveBeenCalled();
  });

  it('404 for a missing character', async () => {
    const { repo, svc } = build();
    repo.lockOwner.mockResolvedValue(null);
    await expect(svc.assign(7, 1, 5)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ValheimArmoryClaimsService.events', () => {
  it('404 for a missing character', async () => {
    const { repo, svc } = build();
    repo.profileExists.mockResolvedValue(false);
    await expect(svc.events(7)).rejects.toBeInstanceOf(NotFoundException);
  });
});
