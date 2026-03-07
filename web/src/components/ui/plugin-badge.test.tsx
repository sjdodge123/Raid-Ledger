import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PluginBadge } from './plugin-badge';

function pluginbadgeGroup1() {
it('renders emoji icon as text', () => {
        const { container } = render(<PluginBadge icon="WoW" label="Test Plugin" />);
        expect(container.textContent).toContain('WoW');
    });

it('renders image icon as img element', () => {
        const { container } = render(
            <PluginBadge icon="/plugins/blizzard/badge.jpg" label="Blizzard" />,
        );
        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
        expect(img?.getAttribute('src')).toBe('/plugins/blizzard/badge.jpg');
    });

}

function pluginbadgeGroup2() {
it('uses iconSmall for sm size when provided', () => {
        const { container } = render(
            <PluginBadge
                icon="/plugins/blizzard/badge.jpg"
                iconSmall="/plugins/blizzard/badge-32.jpg"
                label="Blizzard"
                size="sm"
            />,
        );
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('/plugins/blizzard/badge-32.jpg');
    });

}

function pluginbadgeGroup3() {
it('uses main icon for md size even when iconSmall provided', () => {
        const { container } = render(
            <PluginBadge
                icon="/plugins/blizzard/badge.jpg"
                iconSmall="/plugins/blizzard/badge-32.jpg"
                label="Blizzard"
                size="md"
            />,
        );
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('/plugins/blizzard/badge.jpg');
    });

it('has no text label', () => {
        const { container } = render(
            <PluginBadge icon="/plugins/test/badge.png" label="Test" />,
        );
        const img = container.querySelector('img');
        expect(img).toBeInTheDocument();
        // No text content besides the img
        expect(container.textContent).toBe('');
    });

}

function pluginbadgeGroup4() {
it('marks icon as aria-hidden', () => {
        const { container } = render(
            <PluginBadge icon="/plugins/test/badge.png" label="Test" />,
        );
        const img = container.querySelector('[aria-hidden="true"]');
        expect(img).toBeInTheDocument();
    });

it('sets title attribute for tooltip', () => {
        const { container } = render(
            <PluginBadge icon="/plugins/test/badge.png" label="My Plugin" />,
        );
        const wrapper = container.querySelector('img')?.parentElement;
        expect(wrapper?.getAttribute('title')).toBe('My Plugin');
    });

}

describe('PluginBadge', () => {
    pluginbadgeGroup1();
    pluginbadgeGroup2();
    pluginbadgeGroup3();
    pluginbadgeGroup4();
});
