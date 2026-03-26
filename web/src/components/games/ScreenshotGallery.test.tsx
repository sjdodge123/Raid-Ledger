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
