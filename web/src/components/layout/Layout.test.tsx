import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';

// Layout pulls in a large tree of chrome (header/footer/nav/banners/effects)
// plus several hooks. None of that is relevant to this assertion, which is
// purely about the root container's utility classes. Mock the children and
// hooks down to no-ops so we can render Layout in isolation.
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Footer', () => ({ Footer: () => null }));
vi.mock('./bottom-tab-bar', () => ({ BottomTabBar: () => null }));
vi.mock('./more-drawer', () => ({ MoreDrawer: () => null }));
vi.mock('./live-region-provider', () => ({ LiveRegionProvider: () => null }));
vi.mock('../feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('./SpaceEffects', () => ({ SpaceEffects: () => null }));
vi.mock('./UnderwaterAmbience', () => ({ UnderwaterAmbience: () => null }));
vi.mock('../auth', () => ({ ImpersonationBanner: () => null }));
vi.mock('../ui/DiscordJoinBanner', () => ({ DiscordJoinBanner: () => null }));
vi.mock('../shared/CurrentUserAvatarSync', () => ({ CurrentUserAvatarSync: () => null }));
vi.mock('../../hooks/use-theme-sync', () => ({ useThemeSync: () => undefined }));
vi.mock('../../hooks/use-plugins', () => ({ usePluginHydration: () => undefined }));
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => false }));

function renderLayout(path = '/') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Layout>
                <p>scrolling content</p>
            </Layout>
        </MemoryRouter>,
    );
}

/**
 * ROK-1341: On mobile the themed `bg-backdrop` background previously stopped
 * at one viewport because the root container used `min-h-screen`
 * (`min-height: 100vh`), which locks to a single viewport height. When content
 * scrolls beyond it the background cut off, revealing an unthemed band.
 * The fix swaps to `min-h-dvh` (dynamic viewport height) so the themed
 * container grows with content. BOTH layout root containers are covered: the
 * standard chrome path AND the chromeless (`/p/*` share-link) path, which is a
 * separate root `<div>` that carried the same bug.
 */
describe('Regression: ROK-1341 — mobile themed background covers full scroll height', () => {
    it('standard-path root container uses min-h-dvh so bg-backdrop grows with scroll height', () => {
        const { container } = renderLayout('/');
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('min-h-dvh');
        expect(root).toHaveClass('bg-backdrop');
    });

    it('standard-path root container does NOT use min-h-screen (locks background to one viewport)', () => {
        const { container } = renderLayout('/');
        const root = container.firstElementChild as HTMLElement;
        expect(root).not.toHaveClass('min-h-screen');
    });

    it('chromeless-path (/p/*) root container also uses min-h-dvh and not min-h-screen', () => {
        const { container } = renderLayout('/p/test-event');
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('min-h-dvh');
        expect(root).toHaveClass('bg-backdrop');
        expect(root).not.toHaveClass('min-h-screen');
    });
});
