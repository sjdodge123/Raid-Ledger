/**
 * The hub-post markdown subset (ROK-1868): what the API refuses as HTML or an
 * unsafe link, what stays legal text, the link-safety rule moved from the web
 * renderer, and the plain-text headline.
 */
import { describe, expect, it } from 'vitest';
import {
  findHubPostMarkdownViolation,
  isSafeMarkdownHref,
  markdownToPlainText,
} from '../hub-post-markdown.js';

describe('findHubPostMarkdownViolation', () => {
  it.each([
    '<b>x</b>',
    '<img src=x onerror=1>',
    '<!-- c -->',
    '<a href="x">',
    'hello </div> world',
    '<?xml version="1.0"?>',
    '<!DOCTYPE html>',
    '<img\nsrc=x onerror=alert(1)>',
    'line one <b\nline two>',
  ])('refuses HTML: %s', (body) => {
    expect(findHubPostMarkdownViolation(body)).toBe('html');
  });

  it.each([
    '<3 raiding',
    'a < b and c > d',
    'x<y',
    '`<div>` is a tag',
    '``a `<b>` c``',
    '\\<b>escaped',
    'a <b\nwith no closing bracket',
    '<3\n> quoted',
    '**Raid** at *8*: [plan](https://x.y/a)',
    'see [the hub](/guilds/7?post=3#posts)',
    '<https://raid.gamernight.net/guilds/1>',
    '- one\n- two\n\n1. first',
  ])('allows legal text: %s', (body) => {
    expect(findHubPostMarkdownViolation(body)).toBeNull();
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](//evil.com)',
    '[x](/\\evil.com)',
    '[x](data:text/html,hi)',
    '[x]()',
    '<javascript:alert(1)>',
    '[ok](https://x.y) then [bad](vbscript:x)',
  ])('refuses an unsafe link: %s', (body) => {
    expect(findHubPostMarkdownViolation(body)).toBe('unsafe-link');
  });

  it('ignores a link target inside a code span', () => {
    expect(findHubPostMarkdownViolation('`[x](javascript:1)`')).toBeNull();
  });

  it('scans adversarial 4000-char input in linear time', () => {
    for (const body of ['<'.repeat(4000), '<a'.repeat(2000), ']('.repeat(2000), '`'.repeat(4000)]) {
      const started = performance.now();
      findHubPostMarkdownViolation(body);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe('isSafeMarkdownHref', () => {
  it.each(['https://x.y/a', 'http://x.y', '/guilds/7?post=3#posts'])('accepts %s', (href) => {
    expect(isSafeMarkdownHref(href)).toBe(true);
  });

  it.each(['javascript:alert(1)', '//evil.com', '/\\evil.com', '/\t/evil.com', 'data:x', 'ftp://x', 'a b', ''])(
    'rejects %j',
    (href) => {
      expect(isSafeMarkdownHref(href)).toBe(false);
    },
  );
});

describe('markdownToPlainText', () => {
  it.each([
    ['**Raid** at *8*: [plan](https://x)', 'Raid at 8: plan'],
    ['~~old~~ new __bold__ _it_', 'old new bold it'],
    ['- one\n- two', '• one\n• two'],
    ['1. first\n2. second', '1. first\n2. second'],
    ['use `**not bold**` here', 'use **not bold** here'],
    ['\\*literal\\* stars', '*literal* stars'],
    ['go to <https://x.y/a>', 'go to https://x.y/a'],
    ['snake_case_name stays', 'snake_case_name stays'],
  ])('%j → %j', (body, plain) => {
    expect(markdownToPlainText(body)).toBe(plain);
  });
});
