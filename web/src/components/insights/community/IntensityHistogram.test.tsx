import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IntensityHistogram } from './IntensityHistogram';

describe('IntensityHistogram', () => {
    it('renders empty state for no buckets', () => {
        render(<IntensityHistogram buckets={[]} />);
        expect(screen.getByText(/not enough intensity/i)).toBeInTheDocument();
    });

    it('renders chart for populated buckets', () => {
        render(
            <IntensityHistogram
                buckets={[
                    { bucketStart: 0, bucketEnd: 10, userCount: 3 },
                    { bucketStart: 10, bucketEnd: 20, userCount: 5 },
                ]}
            />,
        );
        expect(screen.getByTestId('intensity-histogram')).toBeInTheDocument();
    });
});
