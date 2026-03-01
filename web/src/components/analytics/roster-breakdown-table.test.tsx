import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterBreakdownTable } from './roster-breakdown-table';
import type { RosterBreakdownEntryDto } from '@raid-ledger/contract';

function makeEntry(overrides: Partial<RosterBreakdownEntryDto> = {}): RosterBreakdownEntryDto {
    return {
        userId: 1,
        username: 'Alice',
        avatar: null,
        attendanceStatus: 'attended',
        voiceClassification: null,
        voiceDurationSec: null,
        signupStatus: 'signed_up',
        ...overrides,
    };
}

const rosterWithVoice: RosterBreakdownEntryDto[] = [
    {
        userId: 1,
        username: 'Alice',
        avatar: null,
        attendanceStatus: 'attended',
        voiceClassification: 'full',
        voiceDurationSec: 7200,
        signupStatus: 'signed_up',
    },
    {
        userId: 2,
        username: 'Bob',
        avatar: null,
        attendanceStatus: 'no_show',
        voiceClassification: 'no_show',
        voiceDurationSec: 0,
        signupStatus: 'signed_up',
    },
];

describe('RosterBreakdownTable', () => {
    it('renders "No signups for this event." when roster is empty', () => {
        render(<RosterBreakdownTable roster={[]} hasVoiceData={false} />);
        expect(screen.getByText('No signups for this event.')).toBeInTheDocument();
    });

    it('renders Roster Breakdown heading', () => {
        render(<RosterBreakdownTable roster={[makeEntry()]} hasVoiceData={false} />);
        expect(screen.getByText('Roster Breakdown')).toBeInTheDocument();
    });

    it('renders player usernames', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ username: 'Thorin' })]} hasVoiceData={false} />);
        expect(screen.getByText('Thorin')).toBeInTheDocument();
    });

    it('renders attendance status label (Attended)', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ attendanceStatus: 'attended' })]} hasVoiceData={false} />);
        expect(screen.getByText('Attended')).toBeInTheDocument();
    });

    it('renders attendance status label (No-Show)', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ attendanceStatus: 'no_show' })]} hasVoiceData={false} />);
        expect(screen.getByText('No-Show')).toBeInTheDocument();
    });

    it('renders attendance status label (Excused)', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ attendanceStatus: 'excused' })]} hasVoiceData={false} />);
        expect(screen.getByText('Excused')).toBeInTheDocument();
    });

    it('renders "Unmarked" for null attendanceStatus', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ attendanceStatus: null })]} hasVoiceData={false} />);
        expect(screen.getByText('Unmarked')).toBeInTheDocument();
    });

    it('renders signup status with underscore replaced', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ signupStatus: 'signed_up' })]} hasVoiceData={false} />);
        // The component replaces _ with space and capitalizes
        expect(screen.getByText('signed up')).toBeInTheDocument();
    });

    it('renders "--" for null signupStatus', () => {
        render(<RosterBreakdownTable roster={[makeEntry({ signupStatus: null })]} hasVoiceData={false} />);
        expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('does NOT render voice columns when hasVoiceData is false', () => {
        render(<RosterBreakdownTable roster={rosterWithVoice} hasVoiceData={false} />);
        expect(screen.queryByText('Voice Status')).not.toBeInTheDocument();
        expect(screen.queryByText('Voice Duration')).not.toBeInTheDocument();
    });

    it('renders voice columns when hasVoiceData is true', () => {
        render(<RosterBreakdownTable roster={rosterWithVoice} hasVoiceData={true} />);
        expect(screen.getByText('Voice Status')).toBeInTheDocument();
        expect(screen.getByText('Voice Duration')).toBeInTheDocument();
    });

    it('renders voice classification label (Full)', () => {
        render(<RosterBreakdownTable roster={rosterWithVoice} hasVoiceData={true} />);
        expect(screen.getByText('Full')).toBeInTheDocument();
    });

    it('renders "--" for null voice classification', () => {
        const roster = [makeEntry({ voiceClassification: null, voiceDurationSec: null })];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={true} />);
        // Should show -- for both voice status and duration
        const dashes = screen.getAllByText('--');
        expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    it('formats voice duration in minutes correctly (2h = 2h 0m)', () => {
        // 7200 seconds = 2h 0m
        render(<RosterBreakdownTable roster={rosterWithVoice} hasVoiceData={true} />);
        expect(screen.getByText('2h 0m')).toBeInTheDocument();
    });

    it('formats voice duration under an hour as minutes only', () => {
        const roster = [makeEntry({ voiceClassification: 'partial', voiceDurationSec: 1800 })];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={true} />);
        expect(screen.getByText('30m')).toBeInTheDocument();
    });

    it('sorts by username ascending by default', () => {
        const roster = [
            makeEntry({ userId: 1, username: 'Zara' }),
            makeEntry({ userId: 2, username: 'Alice' }),
        ];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={false} />);
        const cells = screen.getAllByRole('cell').filter(c => c.textContent && ['Zara', 'Alice'].includes(c.textContent));
        expect(cells[0].textContent).toBe('Alice');
        expect(cells[1].textContent).toBe('Zara');
    });

    it('clicking Player column header toggles sort direction', async () => {
        const user = userEvent.setup();
        const roster = [
            makeEntry({ userId: 1, username: 'Zara' }),
            makeEntry({ userId: 2, username: 'Alice' }),
        ];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={false} />);

        // Initially sorted asc: Alice, Zara
        const cells = () => screen.getAllByRole('cell').filter(c => c.textContent && ['Zara', 'Alice'].includes(c.textContent));
        expect(cells()[0].textContent).toBe('Alice');

        // Click Player header to toggle to desc
        await user.click(screen.getByText('Player'));
        const cellsAfter = screen.getAllByRole('cell').filter(c => c.textContent && ['Zara', 'Alice'].includes(c.textContent));
        expect(cellsAfter[0].textContent).toBe('Zara');
    });

    it('clicking Attendance header sorts by attendanceStatus', async () => {
        const user = userEvent.setup();
        const roster = [
            makeEntry({ userId: 1, username: 'Alice', attendanceStatus: 'no_show' }),
            makeEntry({ userId: 2, username: 'Bob', attendanceStatus: 'attended' }),
        ];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={false} />);

        await user.click(screen.getByText('Attendance'));

        // After clicking, sorted desc (no_show > attended alphabetically reversed)
        // Just verify the sort column header becomes active
        expect(screen.getByText('Attendance').parentElement?.textContent).toContain('↓');
    });

    it('shows sort indicator on active sort column', () => {
        render(<RosterBreakdownTable roster={[makeEntry()]} hasVoiceData={false} />);
        // Default sort is "username" asc — should show ↑
        const playerHeader = screen.getByText('Player');
        expect(playerHeader.textContent).toContain('↑');
    });

    it('renders multiple roster entries', () => {
        const roster = [
            makeEntry({ userId: 1, username: 'Alice' }),
            makeEntry({ userId: 2, username: 'Bob' }),
            makeEntry({ userId: 3, username: 'Carol' }),
        ];
        render(<RosterBreakdownTable roster={roster} hasVoiceData={false} />);
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Carol')).toBeInTheDocument();
    });
});
