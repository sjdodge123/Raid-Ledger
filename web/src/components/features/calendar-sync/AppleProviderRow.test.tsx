/** K1 Apple row (ROK-1598 L5a): availability drives Connect + the hint. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../../../test/render-helpers';
import { AppleProviderRow } from './AppleProviderRow';
import { APPLE_CONNECT_COPY as A } from './apple-connect.copy';

function renderRow(props: { available: boolean; another?: boolean }) {
    return render(<QueryClientProvider client={createTestQueryClient()}><AppleProviderRow {...props} /></QueryClientProvider>);
}

describe('AppleProviderRow', () => {
    it('unavailable → Connect disabled with the hint', () => {
        renderRow({ available: false });
        expect(screen.getByTestId('calendar-connect-apple')).toBeDisabled();
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.unavailable);
    });

    it('available → Connect enabled with the app-specific-password hint', () => {
        renderRow({ available: true });
        expect(screen.getByTestId('calendar-connect-apple')).toBeEnabled();
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hint);
        expect(screen.getByText(A.name)).toBeInTheDocument();
    });

    it('an Apple ID already connected → offers another', () => {
        renderRow({ available: true, another: true });
        expect(screen.getByTestId('calendar-provider-apple-hint')).toHaveTextContent(A.hintAnother);
    });
});
