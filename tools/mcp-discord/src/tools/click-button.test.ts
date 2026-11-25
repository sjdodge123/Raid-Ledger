import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A recording stand-in for Playwright's Page/Locator: every chained call is
 * appended to a path string, count() answers from `counts` by path, and
 * click() records the path it was called on.
 */
interface FakeLocator {
  locator(selector: string): FakeLocator;
  filter(opts: { hasText: string }): FakeLocator;
  last(): FakeLocator;
  nth(i: number): FakeLocator;
  count(): Promise<number>;
  click(): Promise<void>;
}

const counts = new Map<string, number>();
const clicks: string[] = [];

function fakeLocator(path: string): FakeLocator {
  const child = (step: string): FakeLocator =>
    fakeLocator(path ? `${path} > ${step}` : step);
  return {
    locator: (selector) => child(`locator(${selector})`),
    filter: (opts) => child(`filter(${opts.hasText})`),
    last: () => child('last()'),
    nth: (i) => child(`nth(${i})`),
    count: () => Promise.resolve(counts.get(path) ?? 0),
    click: () => {
      clicks.push(path);
      return Promise.resolve();
    },
  };
}

const fakePage = {
  ...fakeLocator(''),
  waitForTimeout: () => Promise.resolve(),
};

vi.mock('../cdp.js', () => ({
  getPage: () => Promise.resolve(fakePage),
}));

import { execute, MESSAGE_ROW, MESSAGE_ROW_FALLBACK } from './click-button.js';

const ROWS = `locator(${MESSAGE_ROW})`;

describe('discord_click_button scoping (tech-debt: click-button.ts:30)', () => {
  beforeEach(() => {
    counts.clear();
    clicks.length = 0;
  });

  it('without messageIndex, only clicks a button inside a chat message row', async () => {
    counts.set(ROWS, 3);
    counts.set(`${ROWS} > locator(button) > filter(Sign Up) > last()`, 1);
    // A same-label button elsewhere on the page (e.g. Discord's own UI).
    counts.set('locator(button) > filter(Sign Up) > last()', 1);

    const result = await execute({ buttonLabel: 'Sign Up' });

    expect(result).toEqual({ success: true });
    expect(clicks).toEqual([`${ROWS} > locator(button) > filter(Sign Up) > last()`]);
  });

  it('never clicks a matching button outside the chat (e.g. Leave Server)', async () => {
    counts.set(ROWS, 3);
    counts.set('locator(button) > filter(Leave Server) > last()', 1);

    const result = await execute({ buttonLabel: 'Leave Server' });

    expect(clicks).toEqual([]);
    expect(result).toEqual({ success: false, error: 'Button "Leave Server" not found on screen' });
  });

  it('with messageIndex, scopes the lookup to that message counted from the bottom', async () => {
    counts.set(ROWS, 3);
    counts.set(`${ROWS} > nth(1) > locator(button) > filter(Tentative) > last()`, 1);

    const result = await execute({ buttonLabel: 'Tentative', messageIndex: 1 });

    expect(result).toEqual({ success: true });
    expect(clicks).toEqual([`${ROWS} > nth(1) > locator(button) > filter(Tentative) > last()`]);
  });

  it('fails without clicking when messageIndex is past the messages on screen', async () => {
    counts.set(ROWS, 2);

    const result = await execute({ buttonLabel: 'Tentative', messageIndex: 5 });

    expect(clicks).toEqual([]);
    expect(result).toEqual({ success: false, error: 'Message 5 not found (2 messages on screen)' });
  });

  it('falls back to messageListItem rows when chat-messages ids are absent', async () => {
    const fallback = `locator(${MESSAGE_ROW_FALLBACK})`;
    counts.set(`${fallback} > locator(button) > filter(Decline) > last()`, 1);

    const result = await execute({ buttonLabel: 'Decline' });

    expect(result).toEqual({ success: true });
    expect(clicks).toEqual([`${fallback} > locator(button) > filter(Decline) > last()`]);
  });
});
