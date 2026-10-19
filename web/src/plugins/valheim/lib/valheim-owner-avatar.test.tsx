/** ROK-1836 Codex r8 — owner chips build the Discord CDN URL from the id + hash, not the bare hash. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { valheimCharacterClaimed } from '../../../test/mocks/valheim-armory-handlers';
import { ValheimCharacterHeader } from '../character/character-header';
import { ValheimCharacterRow } from '../hub/valheim-character-row';

const CDN = 'https://cdn.discordapp.com/avatars/123/abc.png';
const character: ValheimCharacterSummary = {
    ...valheimCharacterClaimed,
    claimedBy: { id: 3, username: 'member1', avatar: 'abc', discordId: '123' },
};

function avatarSrc(container: HTMLElement): string | null {
    return container.querySelector('img')?.getAttribute('src') ?? null;
}

describe('Valheim owner avatar', () => {
    it('the character header renders the Discord CDN avatar', () => {
        const { container } = render(<ValheimCharacterHeader character={character} />);
        expect(avatarSrc(container)).toBe(CDN);
    });

    it('the hub character row renders the Discord CDN avatar', () => {
        const { container } = render(
            <MemoryRouter>
                <ul>
                    <ValheimCharacterRow character={character} hubPath="/guilds/9" />
                </ul>
            </MemoryRouter>,
        );
        expect(avatarSrc(container)).toBe(CDN);
    });
});
