import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventAttendanceDonut } from './event-attendance-donut';
import type { EventAttendanceSummaryDto } from '@raid-ledger/contract';

// Recharts uses SVG and canvas internals that are not fully rendered in jsdom.
// We mock it minimally to isolate behavioral rendering.
vi.mock('recharts', () => ({
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: () => null,
    Cell: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Tooltip: () => null,
}));

function makeSummary(overrides: Partial<EventAttendanceSummaryDto> = {}): EventAttendanceSummaryDto {
    return {
        attended: 8,
        noShow: 2,
        excused: 1,
        unmarked: 1,
        total: 12,
        attendanceRate: 0.73,
        ...overrides,
    };
}

describe('EventAttendanceDonut', () => {
    it('renders attendance percentage in center label', () => {
        render(<EventAttendanceDonut summary={makeSummary({ attendanceRate: 0.75 })} />);
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('rounds attendanceRate to nearest integer percent', () => {
        // 0.736 → 74%
        render(<EventAttendanceDonut summary={makeSummary({ attendanceRate: 0.736 })} />);
        expect(screen.getByText('74%')).toBeInTheDocument();
    });

    it('shows 0% when attendanceRate is 0', () => {
        render(<EventAttendanceDonut summary={makeSummary({ attendanceRate: 0 })} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('shows 100% when all attended', () => {
        render(<EventAttendanceDonut summary={makeSummary({ attendanceRate: 1.0 })} />);
        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('renders stat pills for each category', () => {
        render(<EventAttendanceDonut summary={makeSummary({ attended: 8, noShow: 2, excused: 1, unmarked: 1 })} />);
        // Stat labels
        expect(screen.getByText('Attended:')).toBeInTheDocument();
        expect(screen.getByText('No-Show:')).toBeInTheDocument();
        expect(screen.getByText('Excused:')).toBeInTheDocument();
        expect(screen.getByText('Unmarked:')).toBeInTheDocument();
    });

    it('renders correct stat values', () => {
        render(<EventAttendanceDonut summary={makeSummary({ attended: 8, noShow: 2, excused: 1, unmarked: 1 })} />);
        // Values are rendered as text via font-semibold spans
        expect(screen.getByText('8')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders total signup count', () => {
        render(<EventAttendanceDonut summary={makeSummary({ total: 12 })} />);
        expect(screen.getByText('Total: 12 signups')).toBeInTheDocument();
    });

    it('renders "attended" label below percentage', () => {
        render(<EventAttendanceDonut summary={makeSummary()} />);
        expect(screen.getByText('attended')).toBeInTheDocument();
    });

    it('renders Attendance Summary heading', () => {
        render(<EventAttendanceDonut summary={makeSummary()} />);
        expect(screen.getByText('Attendance Summary')).toBeInTheDocument();
    });

    it('renders pie chart', () => {
        render(<EventAttendanceDonut summary={makeSummary()} />);
        expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
});
