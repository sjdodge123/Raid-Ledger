/**
 * One literal-aware comment stripper for every api source-scanning guard spec
 * (B66 / TDB:1988). Moved verbatim from `embed-colors.guard.spec.ts`, where it
 * replaced a naive `.replace(/\/\/.*$/gm, '')` that read a `//` inside a string
 * or regex literal as a comment and blanked the real code after it — so a
 * forbidden token placed there passed the guard. The web twin lives at
 * `web/src/test/strip-comments.ts`; keep the regex sources identical.
 *
 * Known residuals (no JSX parser here): a `//` in JSX text reads as a line
 * comment, and the regex-literal lookbehind can take `{a} / {b}</span>` as a
 * regex literal. The second keeps text, so it over-reports — the safe side.
 */

/*
 * Literal and comment patterns for `stripComments`. Quote characters are
 * written as `\x27` / `\x22` / `\x60` so these sources hold no raw quote that
 * the stripper, run over this very file, could misread.
 *
 * A regex literal is recognised only where one can start (after an operator,
 * an opening bracket, a keyword or a line start), which tells it apart from
 * division.
 */
const REGEX_LITERAL = String.raw`(?<=(?:^|[(,=:[!&|?{};]|\b(?:return|typeof|case|throw|await|yield|void|delete))\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[dgimsuyv]*`;
const QUOTED_STRING = String.raw`\x27(?:\\.|[^\x27\\\n])*\x27|\x22(?:\\.|[^\x22\\\n])*\x22`;
const TEMPLATE_LITERAL = String.raw`\x60(?:\\.|\$\{(?:[^{}\x60]|\x60(?:\\.|[^\x60\\])*\x60)*\}|[^\x60\\])*\x60`;
const COMMENT = String.raw`(\/\*[\s\S]*?\*\/|\/\/[^\n]*)`;
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
 * file under `api/src`.
 */
export function stripComments(source: string): string {
  return source.replace(
    LITERAL_OR_COMMENT_RE,
    (match: string, comment: string | undefined) =>
      comment === undefined ? match : comment.replace(/[^\n]/g, ' '),
  );
}
