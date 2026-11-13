/**
 * ROK-2188 review — the section watcher's timing contract, under fake timers:
 * it lands AFTER the shell's own open-focus (Modal trap rAF, BottomSheet
 * timer), gives up once the window closes, and takes focus only once.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { focusSettingsSection, watchForSection, SECTION_FOCUS_WINDOW_MS, SETTINGS_SECTION_ATTR } from './use-settings-section-focus';

let host: HTMLDivElement;
let close: HTMLButtonElement;

/** Builds `<section data-settings-section="target">` holding `fieldsHtml`. */
function addSection(fieldsHtml = '<input data-testid="target-input" />'): HTMLElement {
    const section = document.createElement('section');
    section.setAttribute(SETTINGS_SECTION_ATTR, 'target');
    section.innerHTML = fieldsHtml;
    host.appendChild(section);
    return section;
}

function targetInput(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[data-testid="target-input"]');
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    host = document.createElement('div');
    close = document.createElement('button');
    close.textContent = 'Close';
    host.appendChild(close);
    document.body.appendChild(host);
    // The host is the scroller, so the hook takes its scrollTop path (jsdom has no scrollIntoView).
    host.style.overflowY = 'auto';
});

afterEach(() => {
    host.remove();
    vi.useRealTimers();
});

describe('watchForSection (ROK-2188)', () => {
    it('lands after the shell has made its own open-focus, even when the section is already rendered', async () => {
        addSection();
        // What the shells queue on open, before the sheet body's watcher starts.
        window.requestAnimationFrame(() => close.focus());
        window.setTimeout(() => close.focus(), 0);
        const stop = watchForSection(host, 'target');
        await vi.advanceTimersByTimeAsync(100);
        expect(document.activeElement, 'the section field must win over the dialog initial focus (Close)').toBe(targetInput());
        stop();
    });

    it('still lands when the section renders late but within the window', async () => {
        const stop = watchForSection(host, 'target');
        await vi.advanceTimersByTimeAsync(SECTION_FOCUS_WINDOW_MS / 2);
        addSection();
        await vi.advanceTimersByTimeAsync(100);
        expect(document.activeElement).toBe(targetInput());
        stop();
    });

    it('gives up once the window has passed — a late section never steals focus mid-edit', async () => {
        const stop = watchForSection(host, 'target');
        await vi.advanceTimersByTimeAsync(SECTION_FOCUS_WINDOW_MS + 50);
        close.focus();
        addSection();
        await vi.advanceTimersByTimeAsync(100);
        expect(document.activeElement, 'focus stays where the user put it').toBe(close);
        stop();
    });

    it('takes focus only once per open — a later re-render does not re-focus', async () => {
        const section = addSection();
        const stop = watchForSection(host, 'target');
        await vi.advanceTimersByTimeAsync(100);
        expect(document.activeElement).toBe(targetInput());
        close.focus();
        section.appendChild(document.createElement('p'));
        await vi.advanceTimersByTimeAsync(100);
        expect(document.activeElement, 'a re-render after landing must not pull focus back').toBe(close);
        stop();
    });
});

describe('focusSettingsSection field choice', () => {
    it('skips hidden and disabled inputs for the first real field', () => {
        addSection('<input type="hidden" /><input disabled /><select disabled></select><input data-testid="target-input" />');
        expect(focusSettingsSection(host, 'target')).toBe(true);
        expect(document.activeElement, 'hidden and disabled controls cannot take focus').toBe(targetInput());
    });
});
