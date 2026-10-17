/**
 * ROK-1754 §3.6 — a token never travels through the global `fetch`.
 *
 * Third-party script in our origin (Wowhead tooltips.js) can replace the global
 * `fetch` after boot. Any module that handles the access token must therefore
 * call `nativeFetch` (captured at module init in `native-fetch.ts`), never the
 * global one. This scans every non-test source file under `web/src`: a file
 * that mentions a token marker AND calls the global fetch fails the build.
 *
 * Self-reference traps handled deliberately:
 *   1. Comments are stripped BEFORE matching (a comment naming the global call
 *      is not a call).
 *   2. Every needle is ASSEMBLED FROM FRAGMENTS so this file never matches
 *      itself. Do not "tidy" the concatenations back into whole literals.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '../../test/strip-comments';

/** Resolved from `process.cwd()` (vitest runs from `web/`). */
const SRC_DIR = join(process.cwd(), 'src');

/** The ONLY file allowed to touch the global fetch: it captures it. */
const ALLOWLIST = new Set([join('lib', 'api', 'native-fetch.ts')]);

const TOKEN_MARKERS: string[] = [
    'Author' + 'ization',
    'Bear' + 'er',
    'getAuth' + 'Token',
    'getAccess' + 'Token',
    'access' + '_token',
    // Review r4: a file can carry the token via an imported header builder.
    'getHead' + 'ers',
    'authHead' + 'ers',
];

/** Assembled so this file never matches itself (see header). */
const F = 'fe' + 'tch';
const GLOBALS = '(?:window|globalThis|self)';
/** Not part of a longer identifier or a member of something else, nor a type. */
const BARE = '(?<![\\w.$])(?<!typeof\\s{1,10})';
const OWNER = `(?:${GLOBALS}\\s*(?:\\?\\.|\\.)\\s*)?`;

/**
 * Any reach for the global fetch (review r4 widened this):
 *   - a call, bare or via window/globalThis/self, incl. `?.(` and `fetch (`
 *   - bracket access: `window['fetch']`
 *   - an alias / reference: `const f = fetch;`, `{ fetch }`, `use(fetch)`
 *   - `fetch.call(` / `.apply(` / `.bind(`
 *   - a token-carrying XHR built from the global constructor (review r3)
 */
const GLOBAL_FETCH = new RegExp(
    [
        `${BARE}${OWNER}${F}\\s*(?:\\?\\.\\s*)?\\(`,
        `${GLOBALS}\\s*(?:\\?\\.)?\\[\\s*['"\`]${F}['"\`]\\s*\\]`,
        `${BARE}${OWNER}${F}\\s*(?:[;,)\\]}]|$)`,
        `${BARE}${OWNER}${F}\\s*\\.\\s*(?:call|apply|bind)\\b`,
        'new\\s+' + 'XMLHttp' + 'Request\\b',
    ].join('|'),
    'm',
);

function isTestPath(rel: string): boolean {
    return (
        /\.(test|spec)\.tsx?$/.test(rel) ||
        rel.startsWith('test' + '/') ||
        rel.includes('/__tests__/')
    );
}

/** Every non-test `.ts` / `.tsx` under `web/src`, as paths relative to it. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(relative(SRC_DIR, full));
    }
    return out.filter((rel) => !isTestPath(rel));
}

/** Files that mention a token marker and also call the global fetch. */
function findBypasses(files: string[], read: (rel: string) => string): string[] {
    return files.filter((rel) => {
        if (ALLOWLIST.has(rel)) return false;
        const code = stripComments(read(rel));
        const handlesToken = TOKEN_MARKERS.some((m) => code.includes(m));
        return handlesToken && GLOBAL_FETCH.test(code);
    });
}

describe('nativeFetch guard (ROK-1754 §3.6)', () => {
    it('scans a meaningful number of source files', () => {
        expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(200);
    });

    it('no token-handling module calls the global fetch', () => {
        const read = (rel: string) => readFileSync(join(SRC_DIR, rel), 'utf8');
        expect(findBypasses(sourceFiles(SRC_DIR), read)).toEqual([]);
    });

    it('flags a bypass and ignores nativeFetch, refetch and comments', () => {
        const auth = 'Author' + 'ization';
        const call = F + '(';
        const fixtures: Record<string, string> = {
            'bad.ts': `await ${call}url, { headers: { ${auth}: t } });`,
            'bad-window.ts': `window.${call}url, { headers: { ${auth}: t } });`,
            'ok-native.ts': `await native${call.replace('f', 'F')}url, { headers: { ${auth}: t } });`,
            'ok-refetch.ts': `re${call}); const h = { ${auth}: t };`,
            'ok-comment.ts': `// ${call}\nconst h = { ${auth}: t };`,
            'ok-no-token.ts': `await ${call}'/health');`,
            // Review r4: shapes the first regex missed.
            'bad-globalthis.ts': `await globalThis.${call}u, { headers: { ${auth}: t } });`,
            'bad-self.ts': `await self.${call}u, { headers: { ${auth}: t } });`,
            'bad-optional.ts': `await ${F}?.(u, { headers: { ${auth}: t } });`,
            'bad-spaced.ts': `await ${F} (u, { headers: { ${auth}: t } });`,
            'bad-alias.ts': `const f = ${F};\nawait f(u, { headers: { ${auth}: t } });`,
            'bad-alias-eol.ts': `const f = ${F}\nawait f(u, { headers: { ${auth}: t } });`,
            'bad-bracket.ts': `await window['${F}'](u, { headers: { ${auth}: t } });`,
            'bad-call.ts': `await ${F}.call(window, u, { headers: { ${auth}: t } });`,
            'bad-shorthand.ts': `useClient({ ${F} }); const h = { ${auth}: t };`,
            'bad-imported-headers.ts': `await ${call}u, { headers: getHead${'ers'}() });`,
            'bad-xhr.ts': `const x = new XMLHttp${'Request'}(); x.setRequestHeader('${auth}', t);`,
            'ok-typeof.ts': `const f: typeof ${F} = n; const h = { ${auth}: t };`,
            'ok-member.ts': `await client.${call}u); const h = { ${auth}: t };`,
            'ok-native-xhr.ts': `const x = new NativeXHR(); const h = { ${auth}: t };`,
            'ok-string.ts': `throw new Error('Failed to ${F}'); const h = { ${auth}: t };`,
        };
        expect(findBypasses(Object.keys(fixtures), (rel) => fixtures[rel] ?? '')).toEqual([
            'bad.ts',
            'bad-window.ts',
            'bad-globalthis.ts',
            'bad-self.ts',
            'bad-optional.ts',
            'bad-spaced.ts',
            'bad-alias.ts',
            'bad-alias-eol.ts',
            'bad-bracket.ts',
            'bad-call.ts',
            'bad-shorthand.ts',
            'bad-imported-headers.ts',
            'bad-xhr.ts',
        ]);
    });
});
