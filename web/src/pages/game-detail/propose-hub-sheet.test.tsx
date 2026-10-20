/** ROK-1870 — the phone proposal sheet opens tall enough that the 0/280 counter is not clipped by its footer. */
import { describe, expect, it, vi } from 'vitest';
import type { JSX, ReactNode } from 'react';
import { renderWithProviders } from '../../test/render-helpers';
import { mockDesktop } from '../../test/handlers/media';
import { ProposeHubDialog } from './propose-hub-dialog';

const sheetProps = vi.hoisted(() => ({ initiallyExpanded: undefined as boolean | undefined }));

vi.mock('../../components/ui/bottom-sheet', () => ({
    BottomSheet: (p: { initiallyExpanded?: boolean; children: ReactNode }): JSX.Element => {
        sheetProps.initiallyExpanded = p.initiallyExpanded;
        return <div>{p.children}</div>;
    },
}));

describe('ProposeHubDialog on a phone', () => {
    it('opens the BottomSheet expanded', () => {
        mockDesktop(false);
        renderWithProviders(<ProposeHubDialog isOpen onClose={vi.fn()} gameId={5} gameName="Baldur's Gate 3" />);
        expect(sheetProps.initiallyExpanded).toBe(true);
    });
});
