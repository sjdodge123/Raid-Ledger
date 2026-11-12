/**
 * ROK-2187 — the shared GG recipient predicate: the dry run must count what
 * delivery does (placeholder Discord ids get no DM; a Discord opt-out is not
 * a DM).
 */
import type { GgSnapshotV1 } from '@raid-ledger/contract';
import { ggRecipientBucket, hasRealDiscordId } from './gg-eligibility.helpers';
import { tallyGgDryRun } from './gg-dry-run.helpers';

const LIVE = { deactivatedAt: null, prefs: null };

describe('ggRecipientBucket', () => {
  it('local:/unlinked: placeholder ids are not Discord-linked', () => {
    expect(hasRealDiscordId('local:admin@local')).toBe(false);
    expect(hasRealDiscordId('unlinked:42')).toBe(false);
    expect(hasRealDiscordId(null)).toBe(false);
    expect(hasRealDiscordId('810001234567890123')).toBe(true);
    expect(ggRecipientBucket({ ...LIVE, discordId: 'local:a@b' })).toBe(
      'noDiscord',
    );
    expect(ggRecipientBucket({ ...LIVE, discordId: 'unlinked:9' })).toBe(
      'noDiscord',
    );
  });

  it('a gg_ready Discord opt-out (in-app on) is not a DM', () => {
    const prefs = { gg_ready: { inApp: true, push: false, discord: false } };
    expect(ggRecipientBucket({ ...LIVE, discordId: '81000123', prefs })).toBe(
      'optedOut',
    );
  });

  it('deactivated wins; a linked default-prefs user is a DM', () => {
    expect(
      ggRecipientBucket({ ...LIVE, deactivatedAt: new Date(), discordId: '1' }),
    ).toBe('deactivated');
    expect(ggRecipientBucket({ ...LIVE, discordId: '81000123' })).toBe('dm');
  });
});

it('tallyGgDryRun counts buckets, not raw facts', async () => {
  const snap = { tier: 'full' } as GgSnapshotV1;
  const dto = await tallyGgDryRun(
    [
      { id: 1, bucket: 'dm' },
      { id: 2, bucket: 'noDiscord' },
      { id: 3, bucket: 'optedOut' },
      { id: 4, bucket: 'deactivated' },
    ],
    () => Promise.resolve(snap),
    2026,
    null,
  );
  expect(dto.wouldDm).toBe(1);
  expect(dto.skipped).toEqual({
    deactivated: 1,
    optedOut: 1,
    noDiscord: 1,
    noActivity: 0,
  });
  expect(dto.full).toBe(3);
});
