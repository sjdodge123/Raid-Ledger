import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipmentSlot } from './equipment-grid';
import type { EquipmentItemDto } from '@raid-ledger/contract';

/**
 * Mock matchMedia to control mobile/desktop viewport detection.
 * The `useMediaQuery` hook calls `window.matchMedia(query)`.
 */
function mockMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn((query: string) => ({
            matches,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => false),
        })),
    });
}

/** Factory for a minimal EquipmentItemDto */
function createItem(overrides: Partial<EquipmentItemDto> = {}): EquipmentItemDto {
    return {
        slot: 'HEAD',
        name: 'Test Helm',
        itemId: 12345,
        quality: 'EPIC',
        itemLevel: 200,
        itemSubclass: 'Plate',
        enchantments: [],
        sockets: [],
        ...overrides,
    };
}

describe('EquipmentSlot', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Wowhead tooltip suppression on mobile', () => {
        it('strips data-wowhead attribute on mobile viewport', () => {
            mockMatchMedia(true); // mobile: (max-width: 768px) matches

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            const link = screen.getByRole('link', { name: 'Test Helm' });
            expect(link).not.toHaveAttribute('data-wowhead');
        });

        it('preserves data-wowhead attribute on desktop viewport', () => {
            mockMatchMedia(false); // desktop: (max-width: 768px) does not match

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            const link = screen.getByRole('link', { name: 'Test Helm' });
            expect(link).toHaveAttribute('data-wowhead');
        });
    });

    describe('empty slot rendering', () => {
        it('renders empty placeholder when no item provided', () => {
            mockMatchMedia(false);

            render(
                <EquipmentSlot
                    item={undefined}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            expect(screen.getByText('Empty')).toBeInTheDocument();
            expect(screen.getByText('Head')).toBeInTheDocument();
        });
    });

    describe('item click (carousel navigation)', () => {
        it('fires onItemClick on mobile viewport', async () => {
            mockMatchMedia(true);
            const handleClick = vi.fn();
            const user = userEvent.setup();

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                    onItemClick={handleClick}
                />,
            );

            await user.click(screen.getByText('Test Helm'));
            expect(handleClick).toHaveBeenCalledOnce();
        });

        it('fires onItemClick on desktop viewport', async () => {
            mockMatchMedia(false);
            const handleClick = vi.fn();
            const user = userEvent.setup();

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                    onItemClick={handleClick}
                />,
            );

            await user.click(screen.getByText('Test Helm'));
            expect(handleClick).toHaveBeenCalledOnce();
        });
    });
});
