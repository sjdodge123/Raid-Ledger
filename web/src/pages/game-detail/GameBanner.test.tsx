/**
 * Vitest — GameBanner cover art (ROK-1159).
 *
 * The foreground cover is the game-detail page's LCP image: it alone loads at
 * high priority. The blurred backdrop paints the same URL, so it must carry the
 * SAME srcset/sizes — otherwise the browser picks a different candidate for
 * each image and downloads the art twice.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameBanner, type GameBannerGame } from './GameBanner';

vi.mock('../../hooks/use-lfg-groups', () => ({
    useLfgGroupDetail: () => ({ data: undefined }),
}));
vi.mock('./game-detail-lfg-banner', () => ({ GameDetailLfgBanner: () => null }));

const IGDB_COVER = 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg';

function makeGame(overrides: Partial<GameBannerGame> = {}): GameBannerGame {
    return {
        id: 1, slug: 'valheim', name: 'Valheim', coverUrl: IGDB_COVER, summary: null,
        playerCount: null, crossplay: null, firstReleaseDate: null, ...overrides,
    };
}

function renderBanner(game: GameBannerGame) {
    return render(
        <GameBanner game={game} rating={null} genres={[]} platforms={[]} modes={[]} pricing={null} />,
    );
}

function bannerImages(container: HTMLElement): { backdrop: HTMLImageElement; cover: HTMLImageElement } {
    const [backdrop, cover] = Array.from(container.querySelectorAll('img'));
    return { backdrop, cover };
}

describe('GameBanner — cover art loading (ROK-1159)', () => {
    it('loads the foreground cover eagerly at high priority with intrinsic dimensions', () => {
        renderBanner(makeGame());
        const cover = screen.getByRole('img', { name: 'Valheim' });
        expect(cover).toHaveAttribute('fetchpriority', 'high');
        expect(cover).toHaveAttribute('loading', 'eager');
        expect(cover).toHaveAttribute('width', '264');
        expect(cover).toHaveAttribute('height', '374');
    });

    it('gives the blurred backdrop the same srcset and sizes as the cover, without high priority', () => {
        const { container } = renderBanner(makeGame());
        const { backdrop, cover } = bannerImages(container);
        expect(backdrop).toHaveAttribute('alt', '');
        expect(cover.getAttribute('srcset')).toContain('t_cover_big_2x/co1abc.jpg 528w');
        expect(backdrop.getAttribute('srcset')).toBe(cover.getAttribute('srcset'));
        expect(backdrop.getAttribute('sizes')).toBe('(min-width: 640px) 192px, 160px');
        expect(cover.getAttribute('sizes')).toBe(backdrop.getAttribute('sizes'));
        expect(backdrop).toHaveAttribute('width', '264');
        expect(backdrop).not.toHaveAttribute('fetchpriority');
        expect(backdrop).not.toHaveAttribute('loading', 'lazy');
    });

    it('omits srcset on both images for non-IGDB boxart', () => {
        const { container } = renderBanner(
            makeGame({ coverUrl: null, itadBoxartUrl: 'https://assets.isthereanydeal.com/abc/boxart.jpg' }),
        );
        const { backdrop, cover } = bannerImages(container);
        expect(backdrop).not.toHaveAttribute('srcset');
        expect(cover).not.toHaveAttribute('srcset');
        expect(cover).toHaveAttribute('fetchpriority', 'high');
    });
});
