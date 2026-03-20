import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EquipmentSlot, EquipmentGrid } from './equipment-grid';
import type { EquipmentItemDto, CharacterEquipmentDto } from '@raid-ledger/contract';

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

    describe('ItemFallbackTooltip suppression on mobile', () => {
        it('does not render fallback tooltip on mobile even after hover when Wowhead is not loaded', async () => {
            mockMatchMedia(true); // mobile
            // Ensure Wowhead is NOT loaded (no $WowheadPower on window)
            const user = userEvent.setup();

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            // Hover the slot — on mobile the fallback tooltip must NOT appear
            await user.hover(screen.getByText('Test Helm'));
            // The fallback tooltip renders item name in the tooltip div; there should
            // only be one element containing "Test Helm" (the link) — no tooltip clone
            expect(screen.getAllByText('Test Helm')).toHaveLength(1);
        });

        it('renders fallback tooltip on desktop when Wowhead is not loaded and slot is hovered', async () => {
            mockMatchMedia(false); // desktop
            // $WowheadPower absent by default in jsdom — isWowheadLoaded() returns false
            const user = userEvent.setup();

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            await user.hover(screen.getByText('Test Helm'));
            // ItemFallbackTooltip renders the item name in a tooltip element
            // so there are now 2 elements with "Test Helm" text
            expect(screen.getAllByText('Test Helm')).toHaveLength(2);
        });

        it('does not render fallback tooltip on desktop when Wowhead IS loaded', async () => {
            mockMatchMedia(false); // desktop
            // Simulate Wowhead script loaded
            (window as Window & { $WowheadPower?: { refreshLinks: () => void } }).$WowheadPower = {
                refreshLinks: vi.fn(),
            };
            const user = userEvent.setup();

            render(
                <EquipmentSlot
                    item={createItem()}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            await user.hover(screen.getByText('Test Helm'));
            // Only the link itself — no tooltip duplicate
            expect(screen.getAllByText('Test Helm')).toHaveLength(1);

            delete (window as Window & { $WowheadPower?: { refreshLinks: () => void } }).$WowheadPower;
        });
    });

    describe('data-wowhead attribute content on desktop', () => {
        it('produces correct data-wowhead value for retail (null variant)', () => {
            mockMatchMedia(false); // desktop

            render(
                <EquipmentSlot
                    item={createItem({ itemId: 12345 })}
                    slotName="HEAD"
                    gameVariant={null}
                />,
            );

            const link = screen.getByRole('link', { name: 'Test Helm' });
            expect(link).toHaveAttribute('data-wowhead', 'item=12345&domain=www');
        });

        it('produces correct data-wowhead value for classic era variant', () => {
            mockMatchMedia(false); // desktop

            render(
                <EquipmentSlot
                    item={createItem({ itemId: 19019 })}
                    slotName="HEAD"
                    gameVariant="classic"
                />,
            );

            const link = screen.getByRole('link', { name: 'Test Helm' });
            expect(link).toHaveAttribute('data-wowhead', 'item=19019&domain=classic&dataEnv=1');
        });

        it('produces correct data-wowhead value for classic_anniversary (TBC) variant', () => {
            mockMatchMedia(false); // desktop

            render(
                <EquipmentSlot
                    item={createItem({ itemId: 34677 })}
                    slotName="HEAD"
                    gameVariant="classic_anniversary"
                />,
            );

            const link = screen.getByRole('link', { name: 'Test Helm' });
            expect(link).toHaveAttribute('data-wowhead', 'item=34677&domain=tbc');
        });
    });
});

/** Factory for a minimal CharacterEquipmentDto */
function createEquipment(items: EquipmentItemDto[]): CharacterEquipmentDto {
    return {
        equippedItemLevel: null,
        items,
        syncedAt: new Date().toISOString(),
    };
}

describe('EquipmentGrid — mobile data-wowhead suppression across multiple slots', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('strips data-wowhead from every item in the grid on mobile', () => {
        mockMatchMedia(true); // mobile

        const items: EquipmentItemDto[] = [
            createItem({ slot: 'HEAD', name: 'Test Helm', itemId: 1 }),
            createItem({ slot: 'CHEST', name: 'Test Chest', itemId: 2 }),
            createItem({ slot: 'HANDS', name: 'Test Gloves', itemId: 3 }),
        ];

        render(
            <EquipmentGrid
                equipment={createEquipment(items)}
                gameVariant="classic"
                renderUrl={null}
                onItemClick={vi.fn()}
            />,
        );

        const links = screen.getAllByRole('link');
        for (const link of links) {
            expect(link).not.toHaveAttribute('data-wowhead');
        }
    });

    it('preserves data-wowhead on every item in the grid on desktop', () => {
        mockMatchMedia(false); // desktop

        const items: EquipmentItemDto[] = [
            createItem({ slot: 'HEAD', name: 'Test Helm', itemId: 1 }),
            createItem({ slot: 'CHEST', name: 'Test Chest', itemId: 2 }),
            createItem({ slot: 'HANDS', name: 'Test Gloves', itemId: 3 }),
        ];

        render(
            <EquipmentGrid
                equipment={createEquipment(items)}
                gameVariant="classic"
                renderUrl={null}
                onItemClick={vi.fn()}
            />,
        );

        const links = screen.getAllByRole('link');
        for (const link of links) {
            expect(link).toHaveAttribute('data-wowhead');
        }
    });
});
