/** ROK-2185 item 2 — the member-signup phrase on upcoming event cards (operator ruling Q3 = A). */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { GuildEventCardDto, GuildRaidsDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { emptyGuildRaids } from '../../../test/mocks/guild-raids-handlers';
import { GuildEvents } from './guild-events';
import { memberSignupLabel } from './guild-raids.helpers';

function card(overrides: Partial<GuildEventCardDto> = {}): GuildEventCardDto {
    return { id: 1, title: 'Raid', startTime: '2030-01-08T20:00:00.000Z', endTime: '2030-01-08T23:00:00.000Z', signupCount: 6, needed: 10, viewerStatus: null, ...overrides };
}

describe('memberSignupLabel', () => {
    it('names guild members on a WoW guild', () => {
        expect(memberSignupLabel(card({ memberSignupCount: 4 }), 'wow_guild')).toBe('4 guild members');
    });

    it('says plain "members" on community and server hubs', () => {
        expect(memberSignupLabel(card({ memberSignupCount: 4 }), 'game_community')).toBe('4 members');
        expect(memberSignupLabel(card({ memberSignupCount: 4 }), 'game_server')).toBe('4 members');
    });

    it('defaults to the WoW noun when the kind is unknown', () => {
        expect(memberSignupLabel(card({ memberSignupCount: 2 }), undefined)).toBe('2 guild members');
    });

    it('uses the singular for one member', () => {
        expect(memberSignupLabel(card({ memberSignupCount: 1 }), 'wow_guild')).toBe('1 guild member');
        expect(memberSignupLabel(card({ memberSignupCount: 1 }), 'game_server')).toBe('1 member');
    });

    it('shows 0 members once non-members alone have signed up', () => {
        expect(memberSignupLabel(card({ signupCount: 3, memberSignupCount: 0 }), 'wow_guild')).toBe('0 guild members');
    });

    it('is null before anyone signs up or when the server sent no count', () => {
        expect(memberSignupLabel(card({ signupCount: 0, memberSignupCount: 0 }), 'wow_guild')).toBeNull();
        expect(memberSignupLabel(card(), 'wow_guild')).toBeNull();
    });
});

describe('SignupMeter member phrase', () => {
    function raids(e: GuildEventCardDto): GuildRaidsDto {
        return { ...emptyGuildRaids, upcoming: [e] };
    }

    it('appends the member phrase to the signup label', () => {
        renderWithProviders(<GuildEvents raids={raids(card({ memberSignupCount: 4 }))} kind="wow_guild" />);
        expect(screen.getByText('6 / 10 signed up · 4 guild members')).toBeInTheDocument();
    });

    it('keeps the plain label when there is no member count', () => {
        renderWithProviders(<GuildEvents raids={raids(card())} kind="game_community" />);
        expect(screen.getByText('6 / 10 signed up')).toBeInTheDocument();
    });
});
