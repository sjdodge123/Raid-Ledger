/** ROK-1893 P3 — locking a hub poll's time opens the create form with the hub preselected. */
import { describe, it, expect } from 'vitest';
import type { MatchDetailResponseDto, ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { createEventUrl } from './use-scheduling-lock';

const match = { gameId: 5, followupForEventId: null } as unknown as MatchDetailResponseDto;
const slot = { proposedTime: '2030-01-08T20:00:00.000Z' } as unknown as ScheduleSlotWithVotesDto;
const params = (url: string) => new URLSearchParams(url.split('?')[1] ?? '');

describe('createEventUrl — hub polls (ROK-1893 P3)', () => {
    it('carries guildId when the poll has a hub', () => {
        expect(params(createEventUrl(match, { matchId: 41, lineupId: 40, hubId: 7 }, slot)).get('guildId')).toBe('7');
    });
    it('omits guildId for an untagged poll', () => {
        expect(params(createEventUrl(match, { matchId: 41, lineupId: 40, hubId: null }, slot)).has('guildId')).toBe(false);
    });
});
