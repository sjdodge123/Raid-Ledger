// Source helpers for scripts/smoke/discord-bot-guard.mjs: comment stripping,
// literal masking, string-const collection and call-span (scope) detection.

// Literal-aware comment stripper — a copy of web/src/test/strip-comments.ts
// (itself the twin of api/src/common/testing/strip-comments.ts); a .mjs cannot
// import the .ts. Keep the four regex sources identical to those.
const REGEX_LITERAL = String.raw`(?<=(?:^|=>|[(,=:[!&|?{};]|\b(?:return|typeof|case|throw|await|yield|void|delete)|\b(?:if|while|for)\s*\((?:[^()\n]|\([^()\n]*\))*\))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*`;
const QUOTED_STRING = String.raw`\x27(?:\\.|[^\x27\\\n])*\x27|\x22(?:\\.|[^\x22\\\n])*\x22`;
const TEMPLATE_LITERAL = String.raw`\x60(?:\\.|\$\{(?:[^{}\x60]|\x60(?:\\.|[^\x60\\])*\x60)*\}|[^\x60\\])*\x60`;
const COMMENT = String.raw`(\/\*[\s\S]*?\*\/|(?!(?<=\b(?!default:)[a-zA-Z][a-zA-Z0-9+.-]*:)\/\/[^\s/])\/\/[^\n]*)`;
const LITERAL_OR_COMMENT_RE = new RegExp([REGEX_LITERAL, QUOTED_STRING, TEMPLATE_LITERAL, COMMENT].join('|'), 'gm');

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stripComments(source) {
    return source.replace(LITERAL_OR_COMMENT_RE, (match, comment) =>
        comment === undefined ? match : comment.replace(/[^\n]/g, ' '),
    );
}

/** Same-length copy with every string / template / regex literal's body blanked, so brackets inside literals do not count. */
export function maskLiterals(code) {
    return code.replace(LITERAL_OR_COMMENT_RE, (match, comment) =>
        comment !== undefined || match.length < 2 ? match : match[0] + match.slice(1, -1).replace(/[^\n]/g, ' ') + match.slice(-1),
    );
}

/** `const NAME = '…'` / `"…"` / `` `…` `` string consts (`${NAME}` expanded in later values) and regex-literal consts. */
export function collectStringConsts(code) {
    const consts = new Map();
    const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\\n])*)\2/g;
    for (const m of code.matchAll(re)) {
        const value = m[3].replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name) => consts.get(name) ?? all);
        consts.set(m[1], value);
    }
    const regexConst = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*)/g;
    for (const m of code.matchAll(regexConst)) consts.set(m[1], m[2]);
    return consts;
}

const CALLS = [
    ['describe', /(?<![.\w$])(?:test\.)?describe(?:\.(?:only|skip|fixme|serial|parallel))*\s*\(/g],
    ['hook', /(?<![.\w$])(?:test\.)?(?:beforeAll|beforeEach)\s*\(/g],
    ['test', /(?<![.\w$])test(?:\.(?:only|skip|fixme|fail|slow))?\s*\(/g],
    ['route', /\.route\s*\(/g],
];

/** Index just past the bracket matching the one at `open`, plus the end of the first argument. */
function matchParen(masked, open) {
    let depth = 0;
    let argEnd = -1;
    for (let i = open; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) return { end: i + 1, argEnd: argEnd < 0 ? i : argEnd };
        } else if (ch === ',' && depth === 1 && argEnd < 0) argEnd = i;
    }
    return { end: masked.length, argEnd: argEnd < 0 ? masked.length : argEnd };
}

/**
 * Every test / describe / hook / `.route(` call in masked source:
 * `{ kind, start, end, argStart, argEnd, headEnd }` — `headEnd` is where the
 * callback starts (details objects such as `{ annotation }` sit before it).
 */
export function callSpans(masked) {
    const spans = [];
    for (const [kind, re] of CALLS) {
        for (const m of masked.matchAll(re)) {
            const open = m.index + m[0].length - 1;
            const { end, argEnd } = matchParen(masked, open);
            const body = masked.slice(open, end);
            const cb = body.search(/=>|\bfunction\b/);
            spans.push({ kind, start: m.index, end, argStart: open + 1, argEnd, headEnd: cb < 0 ? end : open + cb });
        }
    }
    return spans;
}
