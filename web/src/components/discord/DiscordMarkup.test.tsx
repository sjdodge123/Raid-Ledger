/**
 * ROK-1878 — Discord's inline markup (embeds + message content on the hub
 * mirror) renders as React elements: emphasis, underline, escapes, safe links,
 * local timestamps, and mentions that never show a raw snowflake.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DiscordMarkup } from './DiscordMarkup';
import { formatDiscordTimestamp } from './discord-markup-time';
import type * as TimeModule from './discord-markup-time';
import { parseDiscordMarkup } from './discord-markup.parse';

// Pin locale + zone so every timestamp assertion below is a FIXED string.
vi.mock('./discord-markup-time', async (importOriginal) => {
    const real = await importOriginal<typeof TimeModule>();
    const pinned: TimeModule.DiscordTimestampFormat = { locale: 'en-US', timeZone: 'UTC' };
    return {
        ...real,
        formatDiscordTimestamp: (unix: number, style: TimeModule.DiscordTimestampStyle, format = pinned) =>
            real.formatDiscordTimestamp(unix, style, format),
    };
});

const UNIX = 1792890900;
/** ICU may use a narrow no-break space before AM/PM; compare on plain spaces. */
const norm = (s: string | null | undefined): string | undefined => s?.replace(/\s/g, ' ');
const PROD_SAMPLE = [
    '**Wrennarök** · **pariah\\_\\_\\_**',
    '[Open event ↗](https://raid.gamernight.net/events/281)',
    `📆 <t:${UNIX}:f> (<t:${UNIX}:R>) · 3h`,
    '🔊 <#1509358710139387985>',
].join('\n');

function renderMarkup(text: string, channels: { id: string; name: string }[] = []): HTMLElement {
    return render(<DiscordMarkup text={text} mentions={[]} channels={channels} />).container;
}

afterEach(() => { vi.useRealTimers(); });

describe('DiscordMarkup — the prod Valheim embed (ROK-1878)', () => {
    it('bolds both names and unescapes pariah___', () => {
        const strong = [...renderMarkup(PROD_SAMPLE).querySelectorAll('strong')].map((s) => s.textContent);
        expect(strong).toEqual(['Wrennarök', 'pariah___']);
    });

    it('renders the event link as an anchor opening in a new tab', () => {
        const a = renderMarkup(PROD_SAMPLE).querySelector('a');
        expect(a?.getAttribute('href')).toBe('https://raid.gamernight.net/events/281');
        expect(a?.textContent).toBe('Open event ↗');
        expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(a?.getAttribute('target')).toBe('_blank');
    });

    it('renders <t:…:f> as the viewer-local date+time and <t:…:R> as relative', () => {
        vi.useFakeTimers({ now: new Date((UNIX - 2 * 86400) * 1000), toFake: ['Date'] });
        const times = [...renderMarkup(PROD_SAMPLE).querySelectorAll('time')];
        expect(times.map((t) => norm(t.textContent))).toEqual(['October 25, 2026 at 1:15 AM', 'in 2 days']);
        expect(times[0]?.getAttribute('dateTime')).toBe(new Date(UNIX * 1000).toISOString());
        expect(times[0]?.textContent).toContain(String(new Date(UNIX * 1000).getFullYear()));
    });

    it('shows an unknown channel as #channel and never a raw snowflake', () => {
        const el = renderMarkup(PROD_SAMPLE);
        expect(el.textContent).toContain('🔊 #channel');
        expect(el.textContent).not.toMatch(/\d{17,20}/);
        expect(el.textContent).not.toMatch(/<(?:#|@|t:)/);
    });

    it('names a channel the mirror knows', () => {
        expect(renderMarkup('<#1509358710139387985>', [{ id: '1509358710139387985', name: 'valheim' }]).textContent).toBe('#valheim');
    });

    it('bolds **roknua**', () => {
        expect(renderMarkup('**roknua**').querySelector('strong')?.textContent).toBe('roknua');
    });
});

describe('DiscordMarkup — the inline subset', () => {
    it('renders __x__ as underline (not bold), *x* / _x_ italic, ~~x~~ strike, `x` code', () => {
        const el = renderMarkup('__u__ *i* _j_ ~~s~~ `c` snake_case_name');
        expect(el.querySelector('u')?.textContent).toBe('u');
        expect(el.querySelector('strong')).toBeNull();
        expect([...el.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['i', 'j']);
        expect(el.querySelector('s')?.textContent).toBe('s');
        expect(el.querySelector('code')?.textContent).toBe('c');
        expect(el.textContent).toContain('snake_case_name');
    });

    it('nests emphasis', () => {
        expect(renderMarkup('**a __b__**').querySelector('strong u')?.textContent).toBe('b');
    });

    it('renders an unsafe javascript: link as text, never an anchor', () => {
        const el = renderMarkup('[click](javascript:alert(1))');
        expect(el.querySelector('a')).toBeNull();
        expect(el.textContent).toContain('click');
    });

    it('never renders raw HTML', () => {
        const el = renderMarkup('<img src=x onerror=alert(1)> <b>x</b>');
        expect(el.querySelector('img, b')).toBeNull();
        expect(el.textContent).toBe('<img src=x onerror=alert(1)> <b>x</b>');
    });

    it('keeps an invalid timestamp literal', () => {
        expect(renderMarkup('<t:abc:f> <t:99999999999999999:R> <t:5:Q>').textContent)
            .toBe('<t:abc:f> <t:99999999999999999:R> <t:5:Q>');
    });

    it('renders <t:UNIX> with no style as the f style', () => {
        expect(norm(renderMarkup(`<t:${UNIX}>`).querySelector('time')?.textContent)).toBe('October 25, 2026 at 1:15 AM');
    });

    it('renders a past <t:…:R> as "… ago"', () => {
        vi.useFakeTimers({ now: new Date((UNIX + 3 * 3600) * 1000), toFake: ['Date'] });
        expect(renderMarkup(`<t:${UNIX}:R>`).querySelector('time')?.textContent).toBe('about 3 hours ago');
    });

    it('resolves user/role mentions with neutral fallbacks and emoji as :name:', () => {
        const el = render(
            <DiscordMarkup text="<@111111111111111111> <@!222222222222222222> <@&333333333333333333> <:wave:444444444444444444> <a:spin:555555555555555555>"
                mentions={[{ id: '111111111111111111', kind: 'user', displayName: 'Roknua' }]} />,
        ).container;
        expect(el.textContent).toBe('@Roknua @user @role :wave: :spin:');
        expect(el.textContent).not.toMatch(/\d{17,20}/);
    });
});

describe('DiscordMarkup — delimiter edge cases', () => {
    it('renders ***x*** as bold italic and ___x___ as underlined italic, with no stray delimiter', () => {
        const el = renderMarkup('***x*** ___y___');
        expect(el.querySelector('strong > em')?.textContent).toBe('x');
        expect(el.querySelector('u > em')?.textContent).toBe('y');
        expect(el.textContent).toBe('x y');
    });

    it('nests bold inside asterisk italic', () => {
        const el = renderMarkup('*a **b** c*');
        expect(el.querySelectorAll('em')).toHaveLength(1);
        expect(el.querySelector('em')?.textContent).toBe('a b c');
        expect(el.querySelector('em > strong')?.textContent).toBe('b');
    });

    it('never nests an anchor: a URL label stays text inside the one link', () => {
        const anchors = renderMarkup('[https://good.com](https://evil.com)').querySelectorAll('a');
        expect(anchors).toHaveLength(1);
        expect(anchors[0]?.getAttribute('href')).toBe('https://evil.com');
        expect(anchors[0]?.textContent).toBe('https://good.com');
    });

    it('an escaped delimiter does not close bold', () => {
        const el = renderMarkup('**a\\**b**');
        expect(el.querySelector('strong')?.textContent).toBe('a**b');
        expect(el.textContent).toBe('a**b');
    });

    it('a delimiter inside a code span does not close bold', () => {
        const strong = renderMarkup('**a `b**` c**').querySelector('strong');
        expect(strong?.querySelector('code')?.textContent).toBe('b**');
        expect(strong?.textContent).toBe('a b** c');
        expect(strong?.lastChild?.textContent).toBe(' c');
    });
});

describe('formatDiscordTimestamp', () => {
    it('formats fixed strings in a pinned locale and zone', () => {
        const pinned = { locale: 'en-US', timeZone: 'UTC' };
        expect(norm(formatDiscordTimestamp(UNIX, 't', pinned))).toBe('1:15 AM');
        expect(formatDiscordTimestamp(UNIX, 'd', pinned)).toBe('10/25/2026');
        expect(norm(formatDiscordTimestamp(UNIX, 'f', pinned))).toBe('October 25, 2026 at 1:15 AM');
        expect(norm(formatDiscordTimestamp(UNIX, 'F', pinned))).toBe('Sunday, October 25, 2026 at 1:15 AM');
        expect(norm(formatDiscordTimestamp(UNIX, 'f', { locale: 'en-US', timeZone: 'America/New_York' }))).toBe('October 24, 2026 at 9:15 PM');
    });

    it('covers every Discord style with a non-empty, distinct-enough string', () => {
        for (const style of ['t', 'T', 'd', 'D', 'f', 'F', 'R'] as const) {
            expect(formatDiscordTimestamp(UNIX, style)).not.toBe('');
        }
        expect(formatDiscordTimestamp(UNIX, 'F')?.length).toBeGreaterThan(formatDiscordTimestamp(UNIX, 'f')?.length ?? Infinity);
    });

    it('returns null for an out-of-range timestamp', () => {
        expect(formatDiscordTimestamp(1e17, 'f')).toBeNull();
    });
});

describe('parseDiscordMarkup — pathological input stays fast (ReDoS guard)', () => {
    const ctx = { mentions: [], channels: [] };
    // Exponential backtracking took 212ms at 145 chars and never finished at
    // ~4k (review r2). The limit is generous so CI noise cannot trip it; a
    // regression is orders of magnitude slower, not a few ms.
    it.each([
        ['italic around many **bold** pairs', '*' + 'a **b** '.repeat(400)],
        ['unclosed italic with ** runs', '*' + 'a**'.repeat(1365)],
        ['4096 asterisks', '*'.repeat(4096)],
        ['4096 underscores', '_'.repeat(4096)],
        ['4096 open brackets', '['.repeat(4096)],
        ['4096 backticks', '`'.repeat(4096)],
    ])('%s parses in well under a second', (_name, input) => {
        const start = performance.now();
        parseDiscordMarkup(input, ctx);
        expect(performance.now() - start).toBeLessThan(500);
    });
});
