import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CharacterClassIcon } from './character-class-icon';

describe('CharacterClassIcon slot (ROK-2359)', () => {
    it('renders the class icon with the card-supplied classes', () => {
        const { container } = render(<CharacterClassIcon characterClass="Warrior" iconClassName="w-3.5 h-3.5 rounded-sm" />);
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toMatch(/classicon_warrior\.jpg$/);
        expect(img?.getAttribute('class')).toBe('w-3.5 h-3.5 rounded-sm');
        expect(img?.getAttribute('alt')).toBe('');
    });

    it('renders nothing for an unknown or missing class', () => {
        expect(render(<CharacterClassIcon characterClass="Bard" />).container).toBeEmptyDOMElement();
        expect(render(<CharacterClassIcon characterClass={null} />).container).toBeEmptyDOMElement();
    });
});
