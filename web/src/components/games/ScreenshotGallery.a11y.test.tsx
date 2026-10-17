/**
 * Accessibility (axe-core) tests for ScreenshotGallery (ROK-881).
 * Tests the gallery thumbnail row for a11y violations.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ScreenshotGallery } from './ScreenshotGallery';

const screenshots = [
    'https://example.com/ss1.jpg',
    'https://example.com/ss2.jpg',
];

describe('ScreenshotGallery — axe accessibility (ROK-881)', () => {
    it('gallery thumbnails have no accessibility violations', async () => {
        const { container } = render(
            <ScreenshotGallery
                screenshots={screenshots}
                gameName="Test Game"
            />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
