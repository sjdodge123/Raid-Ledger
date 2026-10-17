/**
 * One literal-aware comment stripper for every web source-scanning guard test
 * (B66 / TDB:1988). The twin of `api/src/common/testing/strip-comments.ts`
 * (the workspaces cannot import each other): the regex sources are identical,
 * only indentation differs — keep them identical. It started in api's
 * `embed-colors.guard.spec.ts`, where it
 * replaced a naive `.replace(/\/\/.*$/gm, '')` that read a `//` inside a string
 * or regex literal as a comment and blanked the real code after it — so a
 * forbidden token placed there passed the guard.
 *
 * A URL scheme (`https://host`: a scheme word, `:`, `//`, then a non-space)
 * is never a comment opener — unquoted prose holds one, a bare `https://…` in
 * JSX text (B66 M1), and keeping it means a token in it is caught. Any other
 * `//` after a colon (`case 'x':// note`, `default:// note`) is still a
 * comment (Codex B66 review). Residual: a label glued to an unspaced comment
 * (`case A://note`) reads as a URL and is kept — over-reports, the safe side.
 * Markdown and other non-JS files must not go through this stripper at all —
 * scan them raw.
 *
 * Known residuals (no JSX parser here): a `//` in JSX text NOT after `:` still
 * reads as a line comment (hides the rest of that line); a `/*` in JSX text
 * (`<p>src/*.ts</p>`) opens a block comment that blanks every line up to the
 * next `*\/` — real code included; and the regex-literal lookbehind can take
 * `{a} / {b}</span>` as a regex literal, which keeps text, so it over-reports.
 */

/*
 * Literal and comment patterns for `stripComments`. Quote characters are
 * written as `\x27` / `\x22` / `\x60` so these sources hold no raw quote that
 * the stripper, run over this very file, could misread.
 *
 * A regex literal is recognised only where one can start (after an operator,
 * an opening bracket, an arrow `=>`, a keyword or a line start), which tells
 * it apart from division. After `)` only an `if`/`while`/`for (...)` head
 * (one nesting level) starts a regex: anywhere else, per the grammar, `/`
 * after `)` or `]` IS division (`foo() /re/` divides), so it stays division.
 * Residual: a deeper-nested condition (`if (a(b(c))) /re/`) is read as
 * division, so a quote or `//` inside that regex can open a fake string or
 * comment.
 */
const REGEX_LITERAL = String.raw`(?<=(?:^|=>|[(,=:[!&|?{};]|\b(?:return|typeof|case|throw|await|yield|void|delete)|\b(?:if|while|for)\s*\((?:[^()\n]|\([^()\n]*\))*\))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*`;
const QUOTED_STRING = String.raw`\x27(?:\\.|[^\x27\\\n])*\x27|\x22(?:\\.|[^\x22\\\n])*\x22`;
const TEMPLATE_LITERAL = String.raw`\x60(?:\\.|\$\{(?:[^{}\x60]|\x60(?:\\.|[^\x60\\])*\x60)*\}|[^\x60\\])*\x60`;
const COMMENT = String.raw`(\/\*[\s\S]*?\*\/|(?!(?<=\b(?!default:)[a-zA-Z][a-zA-Z0-9+.-]*:)\/\/[^\s/])\/\/[^\n]*)`;
const LITERAL_OR_COMMENT_RE = new RegExp(
    [REGEX_LITERAL, QUOTED_STRING, TEMPLATE_LITERAL, COMMENT].join('|'),
    'gm',
);

/**
 * Blank out block and line comments, PRESERVING line and column positions so
 * a hit still reports the file:line a human can jump to.
 *
 * One left-to-right pass that consumes string, template and regex literals
 * whole and keeps them verbatim, so a comment marker inside one (a URL in a
 * string, an escaped slash pair in a regex) can no longer open a "comment"
 * that blanks real code. Keeping literals is also the safe direction: a
 * forbidden token inside a string is over-reported, never hidden. When
 * written, the output matched TypeScript's own comment ranges on every `.ts`
 * file under `api/src`; on `web/src` the only mismatches are a `//` in JSX text.
 */
export function stripComments(source: string): string {
    return source.replace(
        LITERAL_OR_COMMENT_RE,
        (match: string, comment: string | undefined) =>
            comment === undefined ? match : comment.replace(/[^\n]/g, ' '),
    );
}
