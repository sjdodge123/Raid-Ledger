import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderDiscordTimestamps } from './discord-timestamps';

describe('renderDiscordTimestamps (ROK-1403)', () => {
  it('passes plain text through unchanged (no tokens)', () => {
    expect(renderDiscordTimestamps('Nothing to localize here')).toBe(
      'Nothing to localize here',
    );
  });

  it('renders a <t:…:f> token as a localized <time>, not a raw token', () => {
    const { container } = render(
      <p>{renderDiscordTimestamps('Starts <t:1700000000:f> — be there')}</p>,
    );
    expect(container.textContent).not.toContain('<t:');
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
    // The VISIBLE label is a real formatted time (H:MM …), not empty/garbled.
    expect(time?.textContent).toMatch(/\d{1,2}:\d{2}/);
    // Surrounding text is preserved.
    expect(container.textContent).toContain('Starts');
    expect(container.textContent).toContain('be there');
  });

  it('renders "now" for the current instant (<t:…:R>)', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    const epoch = Math.floor(now / 1000);
    const { container } = render(
      <p>{renderDiscordTimestamps(`Right <t:${epoch}:R>`, now)}</p>,
    );
    expect(container.querySelector('time')?.textContent).toBe('now');
  });

  it('does NOT crash on an out-of-range epoch (no dateTime, no throw)', () => {
    // Reachable via a user-controlled event title like `<t:9999999999999:f>`;
    // new Date(ms).toISOString() would throw RangeError and unmount the panel.
    const { container } = render(
      <p>{renderDiscordTimestamps('When: <t:9999999999999:f>')}</p>,
    );
    expect(container.textContent).not.toContain('<t:');
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.hasAttribute('datetime')).toBe(false); // guarded — no crash
    expect(time?.textContent).toContain('Invalid Date');
  });

  it('renders a <t:…:R> token as a relative delta using the given now', () => {
    const now = Date.parse('2026-07-15T12:00:00Z');
    const epoch = Math.floor((now + 2 * 3600 * 1000) / 1000);
    const { container } = render(
      <p>{renderDiscordTimestamps(`Reschedules <t:${epoch}:R>`, now)}</p>,
    );
    expect(container.querySelector('time')?.textContent).toBe('in 2 hours');
    expect(container.textContent).not.toContain('<t:');
  });

  it('renders every token in a message with multiple timestamps', () => {
    const { container } = render(
      <p>
        {renderDiscordTimestamps(
          'From <t:1700000000:f> to <t:1700003600:f>',
        )}
      </p>,
    );
    expect(container.querySelectorAll('time')).toHaveLength(2);
    expect(container.textContent).not.toContain('<t:');
  });
});
