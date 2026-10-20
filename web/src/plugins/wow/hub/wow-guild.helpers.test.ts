/**
 * ROK-1794 (review) — the editor picker's option text names the RL account
 * linked to each roster row, so staff never grant on the roster name alone,
 * and a row no account owns is flagged (and disabled by the picker).
 */
import { describe, it, expect } from 'vitest';
import type { GuildMemberRow } from '@raid-ledger/contract';
import { isUnlinkedRow, memberOptionLabel } from './wow-guild.helpers';

const LINKED_ID = '3f6c1a52-8a3b-4c0e-9d2f-1b2c3d4e5f60';

function row(overrides: Partial<GuildMemberRow> & Pick<GuildMemberRow, 'memberId' | 'name'>): GuildMemberRow {
    return { class: 'Warrior', level: 60, rankIndex: 0, rankName: 'Guild Master', effectiveRole: null, characterId: null, isMain: false, ...overrides };
}

describe('memberOptionLabel / isUnlinkedRow (ROK-1794 review)', () => {
    it('names the linked account and since when, for a staff viewer', () => {
        const m = row({ memberId: 1, name: 'Aldren', characterId: LINKED_ID, linkedAccount: { username: 'aldren-rl', linkedSince: '2026-10-14T12:00:00.000Z' } });
        expect(memberOptionLabel(m)).toMatch(/^Aldren — Guild Master · linked to aldren-rl since (14 Oct 2026|Oct 14, 2026)$/);
        expect(isUnlinkedRow(m)).toBe(false);
    });

    it('flags a row no RL account owns', () => {
        const m = row({ memberId: 2, name: 'Corvin', rankIndex: 2, rankName: 'Veteran' });
        expect(memberOptionLabel(m)).toBe('Corvin — Veteran · not linked to an account');
        expect(isUnlinkedRow(m)).toBe(true);
    });

    it('keeps the plain name and rank for a linked row when the viewer gets no linkedAccount (non-staff)', () => {
        const m = row({ memberId: 3, name: 'Dainel', rankIndex: 3, rankName: 'Member', characterId: LINKED_ID });
        expect(memberOptionLabel(m)).toBe('Dainel — Member');
        expect(isUnlinkedRow(m)).toBe(false);
    });
});
