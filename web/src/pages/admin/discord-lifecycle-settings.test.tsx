/**
 * ROK-1428 (Codex r7 P2) — the Thresholds number boxes are keyed per field:
 * two settings with the same value (createThreshold = maxChangesPerTick = 10)
 * must not share a React key, and each box must follow its own setting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildLifecycleSettings } from '../../test/mocks/channel-lifecycle-handlers';
import { ThresholdsSection } from './discord-lifecycle-settings';

afterEach(() => { vi.restoreAllMocks(); });

/** Every number box's value, in render order (days, threshold, max changes). */
function boxValues(): string[] {
    return screen.getAllByRole('spinbutton').map((el) => (el instanceof HTMLInputElement ? el.value : '<not an input>'));
}

function duplicateKeyWarnings(spy: { mock: { calls: unknown[][] } }): string[] {
    return spy.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => m.includes('same key'));
}

describe('ThresholdsSection keys (Codex r7 P2)', () => {
    it('equal values on two settings render and update independently, with no duplicate-key warning', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const settings = buildLifecycleSettings({ createThreshold: 10, maxChangesPerTick: 10 });
        const onSave = vi.fn();
        const { rerender } = render(<ThresholdsSection settings={settings} onSave={onSave} error={undefined} resetKey={0} />);
        expect(boxValues()).toEqual(['30', '10', '10']);
        rerender(<ThresholdsSection settings={{ ...settings, createThreshold: 5 }} onSave={onSave} error={undefined} resetKey={0} />);
        expect(boxValues()).toEqual(['30', '5', '10']);
        expect(duplicateKeyWarnings(spy)).toEqual([]);
    });
});
