/** ROK-1836 D7 — an atlas that downloads but cannot be decoded falls back to initials. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import {
    valheimAtlas,
    valheimCatalogue,
    valheimCharacterDetail,
} from '../../../test/mocks/valheim-armory-handlers';
import { ItemIcon } from './item-icon';
import { resolveItem } from './item-icon.helpers';
import { useItemIcons } from './use-item-icons';

vi.mock('../hooks/use-valheim-characters', () => ({
    useValheimBlobUrl: (_serverId: number, sha: string | null) =>
        sha === null ? null : 'blob:atlas',
}));

function stubImage(decodes: boolean): void {
    class FakeImage {
        src = '';
        decode(): Promise<void> {
            return decodes
                ? Promise.resolve()
                : Promise.reject(new Error('EncodingError'));
        }
    }
    vi.stubGlobal('Image', FakeImage);
}

function Harness(): JSX.Element {
    const ctx = useItemIcons(
        valheimCharacterDetail({
            atlas: valheimAtlas,
            items: valheimCatalogue,
        }),
    );
    const resolved = resolveItem('SwordIron', ctx.items, ctx.atlas);
    return <ItemIcon resolved={resolved} prefab="SwordIron" ctx={ctx} />;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('useItemIcons atlas decoding', () => {
    it('an atlas that fails to decode leaves the tile on initials, not a blank sprite', async () => {
        stubImage(false);
        const { container } = render(<Harness />);
        // Let the rejected decode settle before judging the face.
        await act(async () => {
            await Promise.resolve();
        });
        expect(
            container.querySelector('[data-face]')?.getAttribute('data-face'),
        ).toBe('initials');
        expect(screen.queryByRole('img')).toBeNull();
    });
    it('an atlas that decodes draws the sprite', async () => {
        stubImage(true);
        render(<Harness />);
        const sprite = await screen.findByRole('img', { name: 'Iron sword' });
        expect(sprite.style.backgroundImage).toBe('url("blob:atlas")');
    });
});
