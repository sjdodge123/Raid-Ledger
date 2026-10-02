/**
 * Unit tests for ScreenshotGallery keyboard accessibility (ROK-881).
 * Verifies Escape key closes the lightbox overlay.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenshotGallery } from './ScreenshotGallery';

const screenshots = [
    'https://example.com/ss1.jpg',
    'https://example.com/ss2.jpg',
];

describe('ScreenshotGallery — lightbox keyboard nav (ROK-881)', () => {
    it('closes lightbox when Escape key is pressed', async () => {
        const user = userEvent.setup();
        render(
            <ScreenshotGallery
                screenshots={screenshots}
                gameName="Test Game"
            />,
        );

        // Open lightbox by clicking first thumbnail
        const thumbnail = screen.getAllByRole('button')[0];
        await user.click(thumbnail);

        // Lightbox should be open — close button visible
        expect(
            screen.getByRole('button', { name: 'Close' }),
        ).toBeInTheDocument();

        // Press Escape to close
        fireEvent.keyDown(document, { key: 'Escape' });

        // Lightbox should be gone
        expect(
            screen.queryByRole('button', { name: 'Close' }),
        ).not.toBeInTheDocument();
    });
});

describe('ScreenshotGallery — screenshot renditions (ROK-1159)', () => {
    const IGDB_SHOT = 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc6abc.jpg';

    it('thumbs reserve the 889x500 box, load lazily and offer screenshot (not cover) renditions', () => {
        render(<ScreenshotGallery screenshots={[IGDB_SHOT]} gameName="Test Game" />);
        const thumb = screen.getByAltText('Test Game screenshot 1');
        expect(thumb).toHaveAttribute('width', '889');
        expect(thumb).toHaveAttribute('height', '500');
        expect(thumb).toHaveAttribute('loading', 'lazy');
        expect(thumb).toHaveAttribute('decoding', 'async');
        expect(thumb).toHaveAttribute('sizes', '256px');
        expect(thumb.getAttribute('srcset')).toContain('t_screenshot_med/sc6abc.jpg 569w');
        expect(thumb.getAttribute('srcset')).not.toContain('t_cover_');
    });

    it('the opened lightbox image is eager, scales freely (no pinned width) and is capped at its intrinsic width', async () => {
        const user = userEvent.setup();
        render(<ScreenshotGallery screenshots={[IGDB_SHOT]} gameName="Test Game" />);
        await user.click(screen.getAllByRole('button')[0]);
        const [, opened] = screen.getAllByAltText('Test Game screenshot 1');
        expect(opened).not.toHaveAttribute('loading');
        expect(opened).not.toHaveAttribute('width');
        expect(opened).not.toHaveAttribute('height');
        expect(opened).toHaveAttribute('sizes', '(max-width: 988px) 90vw, 889px');
        expect(opened.getAttribute('srcset')).toContain('t_screenshot_huge/sc6abc.jpg 1280w');
    });

    it('a non-IGDB screenshot gets no srcset at all', () => {
        render(<ScreenshotGallery screenshots={screenshots} gameName="Test Game" />);
        expect(screen.getByAltText('Test Game screenshot 1')).not.toHaveAttribute('srcset');
    });
});
