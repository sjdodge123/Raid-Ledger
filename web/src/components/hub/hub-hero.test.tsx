/**
 * ROK-1870 verify lane 2 (FAIL 12) — the community blurb renders in the hub
 * hero under the name, and nothing renders when the hub has none.
 */
import type { JSX } from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { buildCommunityPage } from '../../test/factories/community-hub';
import { renderWithProviders } from '../../test/render-helpers';
import { HubHero } from './hub-hero';

function Hero({ page }: { page: GuildPage }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <HubHero ctx={{ page, raids }} module={undefined} nextRaid={null} />;
}

describe('HubHero — community blurb', () => {
    it('shows the blurb under the hub name', () => {
        renderWithProviders(<Hero page={buildCommunityPage()} />);
        expect(screen.getByTestId('hub-hero-blurb')).toHaveTextContent('Honour mode runs');
    });

    it('renders no blurb line when the hub has none', () => {
        const page = buildCommunityPage();
        const community = page.community;
        if (community === undefined) throw new Error('factory page has no community block');
        renderWithProviders(<Hero page={{ ...page, community: { ...community, blurb: null } }} />);
        expect(screen.queryByTestId('hub-hero-blurb')).toBeNull();
    });
});
