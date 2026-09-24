/**
 * ROK-1685 — View games links that carry the clicker's own magic-link token.
 *
 * `fitGamesLink` turns a minted `/games#token=…` link into
 * `/games?q=<term>#token=…` inside Discord's 512-character link cap. The
 * fragment (the token) is never touched; only the term gives way. The pinned
 * card is public, so its View games is a press — never a link, never a token.
 */
import { ButtonStyle, ComponentType } from 'discord.js';
import {
  LFG_COMPOSER_COPY,
  LFG_COMPOSER_TERM_MAX,
} from './lfg-composer.constants';
import {
  DISCORD_LINK_URL_MAX,
  buildComposerCard,
  buildViewGamesLinkButton,
  fitGamesLink,
} from './lfg-composer-card.helpers';

const CLIENT_URL = 'https://raid.gamernight.net';
const GAMES = `${CLIENT_URL}/games`;

/**
 * A fragment shaped like `MagicLinkService.generateLink`'s: `token=` and an
 * HS256 JWT (header, payload, 43-character signature), padded in the payload
 * to exactly `length`. Nothing here is signed — it is a shape, not a token.
 */
function tokenFragment(length: number): string {
  const head =
    'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjQyLCJ1c2VybmFtZSI6';
  const sig = `.${'s'.repeat(43)}`;
  return `${head}${'A'.repeat(length - head.length - sig.length)}${sig}`;
}

/** URL characters `URLSearchParams` spends on one code point of the term. */
function encodedLength(point: string): number {
  return new URLSearchParams({ q: point }).toString().length - 'q='.length;
}

/** The `?q=` a fitted link searches for, decoded. */
function searched(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

/**
 * The link fits, keeps the fragment byte for byte, and searches for a prefix
 * of the term cut at a code point — by no more than the cap forced.
 */
function expectFitted(url: string, term: string, fragment: string): void {
  expect(url.length).toBeLessThanOrEqual(DISCORD_LINK_URL_MAX);
  expect(url.startsWith(`${GAMES}?q=`)).toBe(true);
  expect(url.slice(url.indexOf('#') + 1)).toBe(fragment);
  const kept = Array.from(searched(url));
  const all = Array.from(term);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept).toEqual(all.slice(0, kept.length));
  if (kept.length < all.length) {
    const next = encodedLength(all[kept.length]);
    expect(url.length + next).toBeGreaterThan(DISCORD_LINK_URL_MAX);
  }
}

const WIDE_TERM = '漢'.repeat(LFG_COMPOSER_TERM_MAX);
const ASCII_TERM = '&# '
  .repeat(LFG_COMPOSER_TERM_MAX)
  .slice(0, LFG_COMPOSER_TERM_MAX);

describe.each([260, 320])('fitGamesLink with a %i-character token', (size) => {
  const fragment = tokenFragment(size);
  const link = `${GAMES}#${fragment}`;

  it('builds the fixture it claims to', () => {
    expect(fragment).toHaveLength(size);
    expect(Array.from(ASCII_TERM)).toHaveLength(LFG_COMPOSER_TERM_MAX);
  });

  it('shortens a wide term by whole code points to fit the token', () => {
    const url = fitGamesLink(link, WIDE_TERM) ?? '';
    expectFitted(url, WIDE_TERM, fragment);
    expect(Array.from(searched(url)).length).toBeLessThan(
      LFG_COMPOSER_TERM_MAX,
    );
  });

  it('keeps the token intact behind a term full of & and #', () => {
    const url = fitGamesLink(link, ASCII_TERM) ?? '';
    expectFitted(url, ASCII_TERM, fragment);
    expect(new URL(url).hash).toBe(`#${fragment}`);
  });

  it('keeps a short term whole', () => {
    expect(fitGamesLink(link, 'bg3')).toBe(`${GAMES}?q=bg3#${fragment}`);
  });

  it('hands back the bare link for a blank term', () => {
    expect(fitGamesLink(link, '   ')).toBe(link);
    expect(fitGamesLink(link, '')).toBe(link);
  });
});

describe('fitGamesLink at the edges of the cap', () => {
  it('is null when even the bare link is over the cap', () => {
    const link = `${GAMES}#${'x'.repeat(DISCORD_LINK_URL_MAX)}`;
    expect(fitGamesLink(link, 'bg3')).toBeNull();
  });

  it('keeps a bare link of exactly the cap, dropping the term', () => {
    const link = `${GAMES}#${'x'.repeat(DISCORD_LINK_URL_MAX - GAMES.length - 1)}`;
    expect(link).toHaveLength(DISCORD_LINK_URL_MAX);
    expect(fitGamesLink(link, 'bg3')).toBe(link);
  });

  it('appends the term to a link that has no fragment', () => {
    expect(fitGamesLink(GAMES, 'deep rock')).toBe(`${GAMES}?q=deep+rock`);
  });
});

describe('buildViewGamesLinkButton', () => {
  it('links the finished URL verbatim', () => {
    const url = `${GAMES}?q=bg3#${tokenFragment(260)}`;
    expect(buildViewGamesLinkButton(url)?.toJSON()).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON,
      url,
    });
  });

  it('is absent when there is no link to give', () => {
    expect(buildViewGamesLinkButton(null)).toBeNull();
  });
});

describe('the pinned card never carries a link or a token (ROK-1685 AC3)', () => {
  it('makes View games a press on a public message', () => {
    const json = JSON.stringify(
      buildComposerCard('https://raid.example').components,
    );
    expect(json).not.toMatch(/"url"/);
    expect(json).not.toMatch(/token/i);
    expect(json).toContain('"custom_id":"lfgc:view"');
  });

  it('styles it as a secondary button beside Post an LFG', () => {
    const row = buildComposerCard(CLIENT_URL).components[0].toJSON();
    expect(row.components[1]).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      label: LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON,
      custom_id: 'lfgc:view',
    });
  });

  it.each([null, undefined, '', '   '])(
    'omits View games when no client URL is configured (%p)',
    (clientUrl) => {
      const card = buildComposerCard(clientUrl);
      expect(card.components[0].toJSON().components).toHaveLength(1);
      expect(JSON.stringify(card.components)).not.toContain('lfgc:view');
    },
  );
});
