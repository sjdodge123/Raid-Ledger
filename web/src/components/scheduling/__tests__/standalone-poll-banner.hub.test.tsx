/** ROK-1893 P3 (ruling 8d) — the site-wide polls banner names a hub poll's hub with a chip. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { createMockActivePoll } from '../../../test/mocks/hub-polls-handlers';
import { StandalonePollBanner } from '../standalone-poll-banner';

vi.mock('../../../hooks/use-standalone-poll', () => ({
    useActiveStandalonePolls: () => ({
        isLoading: false,
        data: [createMockActivePoll(), createMockActivePoll({ matchId: 60, gameName: 'Civ VI', hub: null })],
    }),
}));

describe('StandalonePollBanner — hub chip (ROK-1893 P3)', () => {
    it('shows the hub chip only on the hub-tagged poll', () => {
        renderWithProviders(<StandalonePollBanner />);
        const chips = screen.getAllByTitle(/^Tagged to the .* hub$/);
        expect(chips, 'one chip: the untagged poll has none').toHaveLength(1);
        expect(chips[0]).toHaveTextContent('Tavern Regulars');
    });
});
