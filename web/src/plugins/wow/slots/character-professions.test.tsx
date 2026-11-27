import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { CharacterProfessionsDto } from '@raid-ledger/contract';
import { CharacterProfessions } from './character-professions';

const PROFS: CharacterProfessionsDto = {
    primary: [
        { id: 197, slug: 'tailoring', name: 'Tailoring', skillLevel: 450, maxSkillLevel: 450, tiers: [] },
        { id: 186, slug: 'mining', name: 'Mining', skillLevel: 200, maxSkillLevel: 300, tiers: [] },
    ],
    secondary: [],
    syncedAt: '2026-01-01T00:00:00.000Z',
};

describe('CharacterProfessions slot (ROK-2359)', () => {
    it('forwards the separator to ProfessionBadges', () => {
        const { container } = render(<CharacterProfessions professions={PROFS} separator="•" />);
        expect(container.querySelector('[title="Tailoring 450/450"]')).not.toBeNull();
        expect(container.textContent).toContain('•');
    });

    it('keeps the ProfessionBadges middle-dot default when no separator is given', () => {
        const { container } = render(<CharacterProfessions professions={PROFS} />);
        expect(container.textContent).toContain('·');
        expect(container.textContent).not.toContain('•');
    });

    it('renders nothing for null professions', () => {
        expect(render(<CharacterProfessions professions={null} />).container).toBeEmptyDOMElement();
    });
});
