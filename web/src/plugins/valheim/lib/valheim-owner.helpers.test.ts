import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ValheimClaimEvent } from '@raid-ledger/contract';
import {
    claimEventAgo,
    claimEventLabel,
    ownerChip,
    updatedAgo,
} from './valheim-owner.helpers';

const owner = { id: 3, username: 'member1', avatar: null };

describe('ownerChip', () => {
    it('flags an unclaimed character as a warning', () => {
        expect(ownerChip({ claimedBy: null, claimSource: null })).toMatchObject(
            { tone: 'warning', label: 'Unclaimed' },
        );
    });
    it('names an admin assignment', () => {
        expect(
            ownerChip({ claimedBy: owner, claimSource: 'admin' }).label,
        ).toBe('Assigned by an admin');
    });
    it.each([['manual'], ['auto']] as const)(
        'labels a %s claim as Claimed',
        (src) => {
            expect(
                ownerChip({ claimedBy: owner, claimSource: src }).label,
            ).toBe('Claimed');
        },
    );
});

describe('updatedAgo', () => {
    afterEach(() => vi.useRealTimers());
    it('is relative to now', () => {
        const now = new Date('2026-10-19T13:00:00.000Z');
        expect(updatedAgo('2026-10-19T10:00:00.000Z', now)).toBe(
            'Updated about 3 hours ago',
        );
    });
    it('never shows a future time', () => {
        expect(
            updatedAgo(
                '2099-01-01T00:00:00.000Z',
                new Date('2026-10-19T00:00:00.000Z'),
            ),
        ).toBe('Updated just now');
    });
});

const member = { id: 3, username: 'member1', avatar: null };
const admin = { id: 1, username: 'admin', avatar: null };

function ev(over: Partial<ValheimClaimEvent>): ValheimClaimEvent {
    return {
        id: 1,
        profileId: 12,
        action: 'claim',
        fromUserId: null,
        toUserId: null,
        actorUserId: null,
        createdAt: '2026-10-01T10:00:00.000Z',
        ...over,
    };
}

describe('claimEventLabel', () => {
    it.each([
        ['claim', { toUser: member }, 'Claimed by member1'],
        ['claim', {}, 'Claimed by a member'],
        [
            'admin_assign',
            { toUser: member, actor: admin },
            'Assigned to member1 by admin',
        ],
        ['admin_assign', { toUser: member }, 'Assigned to member1'],
        ['admin_assign', { toUser: null, actor: null }, 'Assigned by an admin'],
        [
            'admin_unassign',
            { fromUser: member, actor: admin },
            'Owner removed from member1 by admin',
        ],
        ['admin_unassign', { fromUser: member }, 'Owner removed from member1'],
        ['admin_unassign', {}, 'Owner removed by an admin'],
        ['auto_attach', { toUser: member }, 'Matched member1 by Steam ID'],
        ['auto_attach', {}, 'Matched by Steam ID'],
        [
            'auto_detach',
            { fromUser: member },
            'Steam match removed from member1',
        ],
        ['auto_detach', {}, 'Steam match removed'],
    ] as const)('%s with %o reads "%s"', (action, users, label) => {
        expect(claimEventLabel(ev({ action, ...users }))).toBe(label);
    });
});

describe('claimEventAgo', () => {
    it('is relative to now', () => {
        const now = new Date('2026-10-01T13:00:00.000Z');
        expect(claimEventAgo('2026-10-01T10:00:00.000Z', now)).toBe(
            'about 3 hours ago',
        );
    });
});
