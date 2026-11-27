import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleIcon } from './RoleIcon';

describe('RoleIcon (core role glyphs, ROK-2359)', () => {
    it.each(['tank', 'healer', 'dps'])('renders the %s icon from the core table', (role) => {
        render(<RoleIcon role={role} />);
        expect(screen.getByAltText(role)).toHaveAttribute('src', `/icons/roles/${role}.png`);
    });

    it('renders nothing for a role outside the table', () => {
        const { container } = render(<RoleIcon role="bard" />);
        expect(container).toBeEmptyDOMElement();
    });
});
