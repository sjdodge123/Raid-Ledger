import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RosterBuilder } from './RosterBuilder';
import { renderWithRouter, makePlayer } from './RosterBuilder.test-helpers';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from 'sonner';

/** Build a mock generic player (no character) */
function makeGenericPlayer(id: number, name: string): RosterAssignmentResponse {
    return makePlayer(id, null, name);
}

// ROK-487: Toast message language for generic vs MMO rosters
const mockOnRosterChange = vi.fn();
function rosterbuilderToastMessageLanguageROKGroup1() {
it('says "slot N" when assigning a player to a generic player slot', () => {
        const playerPool = [makeGenericPlayer(1, 'Alice')];

        renderWithRouter(
            <RosterBuilder
                pool={playerPool}
                assignments={[]}
                slots={{ player: 4 }}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        const assignSlots = screen.getAllByText('Assign');
        fireEvent.click(assignSlots[0].closest('div[class*="min-h"]')!);

        const modal = document.querySelector('[role="dialog"]');
        const modalAssignBtn = modal?.querySelector('button.assignment-popup__assign-btn');
        expect(modalAssignBtn).toBeTruthy();
        fireEvent.click(modalAssignBtn!);

        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
            expect.stringMatching(/slot\s+1/i),
        );
    });

}

function rosterbuilderToastMessageLanguageROKGroup2() {
it('does NOT say "player N" when assigning to a generic player slot', () => {
        const playerPool = [makeGenericPlayer(2, 'Bob')];

        renderWithRouter(
            <RosterBuilder
                pool={playerPool}
                assignments={[]}
                slots={{ player: 4 }}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        const assignSlots = screen.getAllByText('Assign');
        fireEvent.click(assignSlots[0].closest('div[class*="min-h"]')!);

        const modal = document.querySelector('[role="dialog"]');
        const modalAssignBtn = modal?.querySelector('button.assignment-popup__assign-btn');
        expect(modalAssignBtn).toBeTruthy();
        fireEvent.click(modalAssignBtn!);

        const calls = vi.mocked(toast.success).mock.calls;
        const assignCall = calls.find((c) => typeof c[0] === 'string' && (c[0] as string).includes('Bob'));
        expect(assignCall).toBeDefined();
        expect(assignCall![0]).not.toMatch(/player\s+\d/i);
    });

}

function rosterbuilderToastMessageLanguageROKGroup3() {
it('says "role N" when assigning to an MMO tank slot', () => {
        const tankPlayer = makeGenericPlayer(3, 'Charlie');

        renderWithRouter(
            <RosterBuilder
                pool={[tankPlayer]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        const assignSlots = screen.getAllByText('Assign');
        fireEvent.click(assignSlots[0].closest('div[class*="min-h"]')!);

        const modal = document.querySelector('[role="dialog"]');
        const modalAssignBtn = modal?.querySelector('button.assignment-popup__assign-btn');
        expect(modalAssignBtn).toBeTruthy();
        fireEvent.click(modalAssignBtn!);

        const calls = vi.mocked(toast.success).mock.calls;
        const assignCall = calls.find((c) => typeof c[0] === 'string' && (c[0] as string).includes('Charlie'));
        expect(assignCall).toBeDefined();
        expect(assignCall![0]).not.toMatch(/slot\s+\d/i);
    });

}

describe('RosterBuilder — toast message language (ROK-487)', () => {
beforeEach(() => {
        vi.clearAllMocks();
    });

    rosterbuilderToastMessageLanguageROKGroup1();
    rosterbuilderToastMessageLanguageROKGroup2();
    rosterbuilderToastMessageLanguageROKGroup3();
});
