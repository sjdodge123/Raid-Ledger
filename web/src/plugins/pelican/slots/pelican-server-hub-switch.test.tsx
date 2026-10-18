/** ROK-1831 — the admin "Make a community hub" switch on a Pelican server row. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';

import { pelicanServerFixture } from '../../../test/mocks/pelican-handlers';
import { CommunityHubSwitch } from './pelican-server-hub-switch';

function renderSwitch(row: PelicanServerRowDto) {
    const onUpdate = vi.fn();
    renderWithProviders(<CommunityHubSwitch row={row} onUpdate={onUpdate} />);
    return { onUpdate, sw: screen.getByTestId(`pelican-server-${row.id}-hub`) };
}

describe('CommunityHubSwitch (ROK-1831)', () => {
    it('is disabled with a hint while the server has no game mapped', () => {
        const { sw } = renderSwitch({ ...pelicanServerFixture, gameId: null, gameName: null, communityHub: null });
        expect(sw).toBeDisabled();
        expect(screen.getByText('Map a game first')).toBeInTheDocument();
    });

    it('turns the hub on with PATCH { communityHub: true }', async () => {
        const row = { ...pelicanServerFixture, communityHub: null };
        const { sw, onUpdate } = renderSwitch(row);
        expect(sw).toBeEnabled();
        await userEvent.click(sw);
        expect(onUpdate).toHaveBeenCalledWith(row.id, { communityHub: true });
    });

    it('shows Open hub when on and Hidden when hidden', () => {
        const { sw } = renderSwitch({ ...pelicanServerFixture, communityHub: { guildId: 12, hidden: false } });
        expect(sw).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId(`pelican-server-${pelicanServerFixture.id}-hub-open`)).toHaveAttribute('href', '/guilds/12');
    });

    it('reads a hidden hub as off, labelled Hidden', () => {
        const { sw } = renderSwitch({ ...pelicanServerFixture, communityHub: { guildId: 12, hidden: true } });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByTestId(`pelican-server-${pelicanServerFixture.id}-hub-hidden`)).toHaveTextContent('Hidden');
    });
});
