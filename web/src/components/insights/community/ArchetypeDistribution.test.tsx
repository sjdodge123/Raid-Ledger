import type { ComponentProps, ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommunityRadarResponseDto } from '@raid-ledger/contract';
import { ArchetypeDistribution } from './ArchetypeDistribution';

/**
 * ROK-1937: recharts paints a tooltip value line `entry.color || '#000'`, and
 * this chart's `<Bar>` has no `fill` (colours come from `<Cell>`s), so without
 * an explicit `itemStyle` the value renders black on the panel. The mock keeps
 * recharts' REAL `DefaultTooltipContent` and feeds it the props the chart
 * hands `<Tooltip>`, with the payload a hovered bar produces (no colour).
 */
vi.mock('recharts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('recharts')>();
    const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
    return {
        ...actual,
        ResponsiveContainer: Passthrough,
        BarChart: Passthrough,
        Bar: Passthrough,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Cell: ({ fill }: { fill?: string }) => <i data-testid="bar-cell" data-fill={fill} />,
        Tooltip: (props: ComponentProps<typeof actual.DefaultTooltipContent>) => (
            <actual.DefaultTooltipContent
                {...props}
                label="Hardcore Raider"
                payload={[{ name: 'count', dataKey: 'count', value: 4, graphicalItemId: 'bar-count' }]}
            />
        ),
    };
});

const ARCHETYPES: CommunityRadarResponseDto['archetypes'] = [
    { intensityTier: 'Hardcore', vectorTitle: 'Raider', count: 4 },
    { intensityTier: 'Casual', vectorTitle: null, count: 2 },
];

describe('ArchetypeDistribution', () => {
    it('gives a Newcomer bar the dim token, not the unknown-tier fallback (ROK-1935)', () => {
        render(
            <ArchetypeDistribution
                archetypes={[...ARCHETYPES, { intensityTier: 'Newcomer', vectorTitle: null, count: 1 }]}
            />,
        );
        const fills = screen.getAllByTestId('bar-cell').map((c) => c.getAttribute('data-fill'));
        expect(fills).toHaveLength(3);
        expect(fills[2]).toBe('var(--color-dim)');
    });

    it('renders empty state when no archetypes are provided', () => {
        render(<ArchetypeDistribution archetypes={[]} />);
        expect(screen.getByText(/no archetype distribution/i)).toBeInTheDocument();
    });

    it('renders chart container for populated archetypes', () => {
        render(<ArchetypeDistribution archetypes={ARCHETYPES} />);
        expect(screen.getByTestId('archetype-distribution')).toBeInTheDocument();
    });

    it('paints the tooltip value line in the foreground token, not recharts\' #000 fallback', () => {
        render(<ArchetypeDistribution archetypes={ARCHETYPES} />);
        const value = screen.getByText('4', { selector: '.recharts-tooltip-item-value' });
        const item = value.closest('li');
        expect(item?.style.color).toBe('var(--color-foreground)');
        expect(item?.getAttribute('style') ?? '').not.toMatch(/#000|rgb\(0, 0, 0\)/);
    });

    it('draws the tooltip box and title on theme tokens', () => {
        const { container } = render(<ArchetypeDistribution archetypes={ARCHETYPES} />);
        const box = container.querySelector('.recharts-default-tooltip');
        expect(box?.getAttribute('style') ?? '').toContain('var(--color-panel)');
        expect(box?.getAttribute('style') ?? '').not.toMatch(/#0f172a|#334155/);
        const title = screen.getByText('Hardcore Raider', { selector: '.recharts-tooltip-label' });
        expect(title.style.color).toBe('var(--color-foreground)');
    });
});
