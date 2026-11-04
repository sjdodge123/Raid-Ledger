/** ROK-1931 Q2 = A — the header's "Deaths (all worlds)" line from the detail read's `deathCount`. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { valheimCharacterClaimed } from '../../../test/mocks/valheim-armory-handlers';
import { ValheimCharacterHeader } from './character-header';

describe('ValheimCharacterHeader — lifetime deaths (ROK-1931)', () => {
    it('shows "Deaths (all worlds): N" in text-muted when deathCount is a number', () => {
        render(<ValheimCharacterHeader character={{ ...valheimCharacterClaimed, deathCount: 57 }} />);
        const line = screen.getByText('Deaths (all worlds): 57');
        expect(line.className).toContain('text-muted');
    });

    it('shows zero deaths — 0 is a reported stat, not a missing one', () => {
        render(<ValheimCharacterHeader character={{ ...valheimCharacterClaimed, deathCount: 0 }} />);
        expect(screen.getByText('Deaths (all worlds): 0')).toBeInTheDocument();
    });

    it('hides the line when deathCount is null or absent', () => {
        const { unmount } = render(
            <ValheimCharacterHeader character={{ ...valheimCharacterClaimed, deathCount: null }} />,
        );
        expect(screen.queryByText(/Deaths \(all worlds\)/)).not.toBeInTheDocument();
        unmount();
        render(<ValheimCharacterHeader character={valheimCharacterClaimed} />);
        expect(screen.queryByText(/Deaths \(all worlds\)/)).not.toBeInTheDocument();
    });
});
