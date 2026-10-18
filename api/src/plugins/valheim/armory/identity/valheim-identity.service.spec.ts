/**
 * ROK-1835 L3 — identity rules A1/A2/A3 against a mocked repository: an
 * existing claim (manual/admin/auto) is never re-matched, no match leaves the
 * profile unclaimed, and every attach/detach writes one audit row.
 */
import type { ValheimProfileRow } from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import type { ValheimIdentityRepository } from './valheim-identity.repository';
import { ValheimIdentityService } from './valheim-identity.service';

const tx = {} as ValheimLinkTx;

function build() {
  const repo = {
    autoAttachProfile: jest.fn().mockResolvedValue(null),
    attachBySteamId: jest.fn().mockResolvedValue([]),
    detachAutoBySteamId: jest.fn().mockResolvedValue([]),
    insertEvents: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((fn: (t: ValheimLinkTx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const svc = new ValheimIdentityService(
    repo as unknown as ValheimIdentityRepository,
  );
  return { repo, svc };
}

const profile = (over: Partial<ValheimProfileRow> = {}): ValheimProfileRow =>
  ({
    id: 7,
    steamId: '76561198000000001',
    claimedBy: null,
    claimSource: null,
    ...over,
  }) as ValheimProfileRow;

describe('ValheimIdentityService.onProfileUpserted (A1)', () => {
  it.each(['manual', 'admin', 'auto'] as const)(
    'never re-matches a %s claim',
    async (source) => {
      const { repo, svc } = build();
      await svc.onProfileUpserted(
        tx,
        profile({ claimedBy: 3, claimSource: source }),
      );
      expect(repo.autoAttachProfile).not.toHaveBeenCalled();
      expect(repo.insertEvents).not.toHaveBeenCalled();
    },
  );

  it('leaves the profile unclaimed when no verified user matches', async () => {
    const { repo, svc } = build();
    await svc.onProfileUpserted(tx, profile());
    expect(repo.autoAttachProfile).toHaveBeenCalledWith(tx, 7);
    expect(repo.insertEvents).not.toHaveBeenCalled();
  });

  it('audits auto_attach (system actor) when a verified user matches', async () => {
    const { repo, svc } = build();
    repo.autoAttachProfile.mockResolvedValue(42);
    await svc.onProfileUpserted(tx, profile());
    expect(repo.insertEvents).toHaveBeenCalledWith(tx, [
      {
        profileId: 7,
        action: 'auto_attach',
        fromUserId: null,
        toUserId: 42,
        actorUserId: null,
      },
    ]);
  });
});

describe('ValheimIdentityService link / unlink (A2, A3)', () => {
  it('attaches every unclaimed profile for the linked SteamID, one audit row each', async () => {
    const { repo, svc } = build();
    repo.attachBySteamId.mockResolvedValue([1, 2]);
    await svc.attachForUser(9, '765');
    expect(repo.attachBySteamId).toHaveBeenCalledWith(tx, 9, '765');
    const rows = repo.insertEvents.mock.calls[0]?.[1] as unknown[];
    expect(rows).toEqual([
      expect.objectContaining({ profileId: 1, action: 'auto_attach', toUserId: 9 }),
      expect.objectContaining({ profileId: 2, action: 'auto_attach', toUserId: 9 }),
    ]);
  });

  it('detaches only auto claims on unlink and audits auto_detach', async () => {
    const { repo, svc } = build();
    repo.detachAutoBySteamId.mockResolvedValue([5]);
    await svc.detachForUser(9, '765');
    expect(repo.detachAutoBySteamId).toHaveBeenCalledWith(tx, 9, '765');
    expect(repo.insertEvents).toHaveBeenCalledWith(tx, [
      {
        profileId: 5,
        action: 'auto_detach',
        fromUserId: 9,
        toUserId: null,
        actorUserId: null,
      },
    ]);
  });

  it('writes no audit rows when nothing changed', async () => {
    const { repo, svc } = build();
    await svc.attachForUser(9, '765');
    await svc.detachForUser(9, '765');
    expect(repo.insertEvents).not.toHaveBeenCalled();
  });
});
