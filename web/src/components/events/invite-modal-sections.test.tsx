import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DiscordMemberSearchResult } from '../../lib/api-client';
import { MemberList } from './invite-modal-sections';

// Own file: invite-modal.test.tsx's beforeEach re-assigns navigator.clipboard, which throws
// once userEvent.setup() has installed its getter — a second test there is order-dependent.
describe('MemberList — dead avatar (ROK-1714)', () => {
    it('swaps a broken member avatar for the initial', () => {
        const member: DiscordMemberSearchResult = { discordId: '111', username: 'halfdead', avatar: 'deadhash' };
        const { container } = render(
            <MemberList members={[member]} isLoadingMembers={false} isSearching={false} searchQuery=""
                isSubmitting={false} getMemberStatus={() => null} onMemberClick={() => {}} />,
        );

        fireEvent.error(container.querySelector('img')!);

        expect(container.querySelector('img'), 'broken img should be replaced').toBeNull();
        expect(screen.queryByText('H'), 'initial fallback should render after the img error').not.toBeNull();
    });
});
