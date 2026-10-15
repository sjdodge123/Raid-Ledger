import { diffGameRole, type GameRoleDiffInput } from './game-role-diff.helpers';
import type { DesiredMember } from './game-role-desired.helpers';

const NOW = new Date('2026-10-15T12:00:00Z');
const played = (iso: string): Date => new Date(iso);

function input(over: Partial<GameRoleDiffInput>): GameRoleDiffInput {
  return {
    desired: new Map<number, DesiredMember>(),
    holders: new Set<string>(),
    grants: new Map<number, string>(),
    guildMemberIds: new Set<string>(['d1', 'd2', 'd3']),
    now: NOW,
    windowDays: 14,
    ...over,
  };
}

describe('diffGameRole (ROK-1767)', () => {
  it('adds a guild member who played and does not hold the role', () => {
    const diff = diffGameRole(
      input({
        desired: new Map([
          [1, { discordUserId: 'd1', lastPlayedAt: played('2026-10-14T20:00:00Z') }],
          // Played but not in the guild — cannot be given a role.
          [9, { discordUserId: 'd9', lastPlayedAt: played('2026-10-14T20:00:00Z') }],
        ]),
      }),
    );
    expect(diff.add).toEqual([
      { userId: 1, discordUserId: 'd1', reason: 'played 2026-10-14' },
    ]);
    expect(diff.remove).toEqual([]);
    expect(diff.dropGrant).toEqual([]);
  });

  it('removes a bot-granted holder who went idle, with the last-played date', () => {
    const diff = diffGameRole(
      input({
        holders: new Set(['d2']),
        grants: new Map([[2, 'd2']]),
        hints: new Map([[2, { kind: 'idle', lastPlayedAt: played('2026-09-20T08:00:00Z') }]]),
      }),
    );
    expect(diff.remove).toEqual([
      { userId: 2, discordUserId: 'd2', reason: 'idle since 2026-09-20' },
    ]);
    expect(diff.add).toEqual([]);
  });

  it('never removes a hand-assigned holder (no grant row), even when idle', () => {
    const diff = diffGameRole(input({ holders: new Set(['d3']) }));
    expect(diff).toEqual({ add: [], remove: [], dropGrant: [] });
  });

  it('forgets a grant whose role was removed by hand, without a Discord call', () => {
    const diff = diffGameRole(input({ grants: new Map([[2, 'd2']]) }));
    expect(diff.dropGrant).toEqual([{ userId: 2, reason: 'removed by hand' }]);
    expect(diff.remove).toEqual([]);
  });

  it('drops the grant of a member who left the guild', () => {
    const diff = diffGameRole(input({ grants: new Map([[7, 'd7']]) }));
    expect(diff.dropGrant).toEqual([{ userId: 7, reason: 'left guild' }]);
    expect(diff.remove).toEqual([]);
  });

  it('removes an opted-out or deactivated granted holder with that reason', () => {
    const diff = diffGameRole(
      input({
        holders: new Set(['d1', 'd2']),
        grants: new Map([
          [1, 'd1'],
          [2, 'd2'],
        ]),
        hints: new Map([
          [1, { kind: 'opted_out' }],
          [2, { kind: 'deactivated' }],
        ]),
      }),
    );
    expect(diff.remove).toEqual([
      { userId: 1, discordUserId: 'd1', reason: 'opted out' },
      { userId: 2, discordUserId: 'd2', reason: 'deactivated' },
    ]);
  });

  it('keeps a still-playing granted holder and falls back to the window start for idle', () => {
    const diff = diffGameRole(
      input({
        desired: new Map([
          [1, { discordUserId: 'd1', lastPlayedAt: played('2026-10-10T00:00:00Z') }],
        ]),
        holders: new Set(['d1', 'd2']),
        grants: new Map([
          [1, 'd1'],
          [2, 'd2'],
        ]),
      }),
    );
    expect(diff.add).toEqual([]);
    expect(diff.remove).toEqual([
      { userId: 2, discordUserId: 'd2', reason: 'idle since 2026-10-01' },
    ]);
    expect(diff.dropGrant).toEqual([]);
  });
});
