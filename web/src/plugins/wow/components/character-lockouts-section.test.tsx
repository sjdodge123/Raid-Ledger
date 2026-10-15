/**
 * ROK-1743: Saved instances card — row grammar, cleared colour, null
 * difficulty, and the hidden states (absent, all expired).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CharacterLockoutDto, CharacterLockoutsDto } from '@raid-ledger/contract';
import { CharacterLockoutsSection } from './character-lockouts-section';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function lockout(overrides: Partial<CharacterLockoutDto> = {}): CharacterLockoutDto {
    return {
        name: 'Molten Core', instanceId: 409, difficultyId: 9, difficulty: '40 Player',
        resetAt: inHours(3 * 24 + 4), killed: 3, total: 10, ...overrides,
    };
}

function lockouts(instances: CharacterLockoutDto[]): CharacterLockoutsDto {
    return { source: 'addon', syncedAt: '2026-10-14T20:00:00.000Z', instances };
}

const rowsIn = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-lockout-row]'));

describe('CharacterLockoutsSection', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('renders one row per unexpired lockout with name, difficulty, k/t and countdown', () => {
        const { container } = render(<CharacterLockoutsSection lockouts={lockouts([
            lockout(),
            lockout({ name: 'Onyxia\'s Lair', instanceId: 249, killed: 1, total: 1, resetAt: inHours(5.2) }),
        ])} />);
        expect(screen.getByRole('heading', { name: 'Saved instances' })).toBeTruthy();
        expect(screen.getByText('via addon · 14 Oct 2026')).toBeTruthy();
        const [mc, ony] = rowsIn(container);
        expect(mc?.textContent).toBe('Molten Core40 Player3/10 bosses killedResets in 3d 4h');
        expect(ony?.textContent).toBe('Onyxia\'s Lair40 Player1/1 bosses killedResets in 5h 12m');
    });

    it('colours a full clear text-success and a partial clear text-muted', () => {
        render(<CharacterLockoutsSection lockouts={lockouts([
            lockout({ instanceId: 1, killed: 10, total: 10 }), lockout({ instanceId: 2, killed: 3, total: 10 }),
        ])} />);
        expect(screen.getByText('10/10', { exact: false }).className).toContain('text-success');
        expect(screen.getByText('3/10', { exact: false }).className).toContain('text-muted');
    });

    it('omits the difficulty label when it is null', () => {
        const { container } = render(<CharacterLockoutsSection lockouts={lockouts([lockout({ difficulty: null })])} />);
        expect(rowsIn(container)[0]?.textContent).toBe('Molten Core3/10 bosses killedResets in 3d 4h');
    });

    it('drops lockouts whose reset has passed', () => {
        const { container } = render(<CharacterLockoutsSection lockouts={lockouts([
            lockout({ name: 'Expired Keep', instanceId: 1, resetAt: inHours(-1) }), lockout(),
        ])} />);
        expect(rowsIn(container).map((r) => r.firstChild?.textContent)).toEqual(['Molten Core']);
    });

    it.each<[string, CharacterLockoutsDto | undefined]>([
        ['no lockouts field', undefined],
        ['an empty instance list', lockouts([])],
        ['every lockout expired', lockouts([lockout({ resetAt: inHours(-2) })])],
    ])('renders nothing for %s', (_label, value) => {
        const { container } = render(<CharacterLockoutsSection lockouts={value} />);
        expect(container.innerHTML).toBe('');
    });
});
