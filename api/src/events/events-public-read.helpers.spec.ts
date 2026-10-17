/**
 * ROK-1824 — the anonymous activity projection whitelists metadata keys too,
 * so a key later added by an activity writer never reaches signed-out callers.
 */
import type { ActivityEntryDto } from '@raid-ledger/contract';
import { toPublicActivityEntry } from './events-public-read.helpers';

function entry(metadata: Record<string, unknown> | null): ActivityEntryDto {
  return {
    id: 1,
    action: 'event_rescheduled',
    actor: { id: 3, displayName: 'Ann' },
    metadata,
    createdAt: '2026-10-17T00:00:00.000Z',
  };
}

describe('toPublicActivityEntry metadata whitelist (ROK-1824)', () => {
  it('keeps the timeline keys and drops anything else', () => {
    const out = toPublicActivityEntry(
      entry({
        reason: 'r',
        oldStart: 'a',
        newStart: 'b',
        title: 't',
        role: 'tank',
        note: 'n',
        gameName: 'g',
        userId: 99,
        email: 'x@y.z',
      }),
    );
    expect(out.metadata).toEqual({
      reason: 'r',
      oldStart: 'a',
      newStart: 'b',
      title: 't',
      role: 'tank',
      note: 'n',
      gameName: 'g',
    });
  });

  it('passes a null metadata through as null', () => {
    expect(toPublicActivityEntry(entry(null)).metadata).toBeNull();
  });
});
