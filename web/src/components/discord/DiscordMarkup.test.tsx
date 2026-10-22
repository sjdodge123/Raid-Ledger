/**
 * ROK-1878 — Discord's inline markup (embeds + message content on the hub
 * mirror) renders as React elements: emphasis, underline, escapes, safe links,
 * local timestamps, and mentions that never show a raw snowflake.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DiscordMarkup } from './DiscordMarkup';
import { formatDiscordTimestamp } from './discord-markup-time';

const UNIX = 1792890900;
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
        expect(times.map((t) => t.textContent)).toEqual([formatDiscordTimestamp(UNIX, 'f'), 'in 2 days']);
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
        expect(renderMarkup(`<t:${UNIX}>`).querySelector('time')?.textContent).toBe(formatDiscordTimestamp(UNIX, 'f'));
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

describe('formatDiscordTimestamp', () => {
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
