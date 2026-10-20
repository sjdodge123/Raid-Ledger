/** ROK-1870 — the events card's empty states follow the hub kind (no "guild" on a community hub). */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { emptyGuildRaids } from '../../../test/mocks/guild-raids-handlers';
import { GuildEvents } from './guild-events';

describe('GuildEvents copy', () => {
    it('a community hub talks about hub events', () => {
        renderWithProviders(<GuildEvents raids={emptyGuildRaids} compact kind="game_community" />);
        expect(screen.getByText('No upcoming hub events. A hub editor can pick this hub when creating an event.')).toBeInTheDocument();
        expect(screen.getByText('No hub events in the last 8 weeks.')).toBeInTheDocument();
        expect(screen.queryByText(/guild events/)).not.toBeInTheDocument();
    });

    it('a WoW guild keeps the guild copy', () => {
        renderWithProviders(<GuildEvents raids={emptyGuildRaids} compact kind="wow_guild" />);
        expect(screen.getByText('No upcoming guild events. A guild editor can pick this guild when creating an event.')).toBeInTheDocument();
    });
});
