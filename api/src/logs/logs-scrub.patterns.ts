/**
 * Secret-scrubbing patterns for log downloads and exports. Every regex here
 * must stay linear on adversarial input (a 200k-char line of its own prefix
 * repeated) — see the timing guard in `logs.service.spec.ts`.
 */

/**
 * Key=value / `Key: value` patterns. A match keeps everything up to its
 * first `=` (or `:`) and redacts the rest — see {@link redactKeyedMatch}.
 */
const KEYED_SCRUB_PATTERNS: RegExp[] = [
  /DATABASE_URL=\S+/gi,
  /JWT_SECRET=\S+/gi,
  /password=\S+/gi,
  /\b(?:access_token|refresh_token|api_token|auth_token|bearer_token)=\S+/gi,
  // ROK-1630: a bare `token=` query parameter (`?token=`, `&token=`). The
  // lookbehind keeps `next_token=` / `session_token=` out, as before.
  /(?<![A-Za-z0-9_])token=\S+/gi,
  /secret=\S+/gi,
  /Authorization:\s*\S+(\s+\S+)?/gi,
];

/** A scrub pattern plus the literal replacement it is rewritten to. */
interface ShapedScrubRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Secret shapes the keyed patterns miss (backlog 2938). They run first, so a
 * greedy `\S+` above cannot swallow a JSON closing quote. Every pattern is
 * linear: no nested quantifiers over overlapping character classes.
 */
const SHAPED_SCRUB_RULES: ShapedScrubRule[] = [
  // `"password":"…"`, `"clientSecret": "…"`, `"apiKey":"…"`, `"x-api-key"`,
  // `"idToken"`, `"jwt"`, `"cookie":"…"` — the key names the keyed patterns
  // cover; the value honours `\"` escapes.
  {
    pattern:
      /("(?:[A-Za-z0-9_]*(?:password|secret)|(?:access|refresh|api|auth|bearer|id)_?token|token|jwt|(?:x-)?api[_-]?key|database_url|authorization|(?:set-)?cookie)"\s*:\s*")[^"\\]*(?:\\.[^"\\]*)*"/gi,
    replacement: '$1[REDACTED]"',
  },
  // pino-http's array form `"set-cookie":["a=1; HttpOnly","b=2"]` — every
  // string in the array collapses to one `"[REDACTED]"`.
  {
    pattern:
      /("(?:set-)?cookie"\s*:\s*\[\s*)"[^"\\]*(?:\\.[^"\\]*)*"(?:\s*,\s*"[^"\\]*(?:\\.[^"\\]*)*")*/gi,
    replacement: '$1"[REDACTED]"',
  },
  // A bare JWT (`eyJ<header>.<payload>.<signature>`), the whole match.
  {
    // The lookbehind (not `\b`) stops a retry at every `eyJ` inside a
    // `-`-joined run, which made `"-eyJa".repeat(40000)` quadratic.
    pattern:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    replacement: '[REDACTED]',
  },
  // `?key=` / `&key=` / `?api_key=` / `&apikey=` API keys. The value stops at
  // the next parameter AND at a quote/`,`/`}`/`]`/`)`, so a URL inside a JSON
  // string keeps its closing quote and the fields after it.
  {
    pattern: /([?&](?:api_?)?key=)[^\s"'&#,}\])]+/gi,
    replacement: '$1[REDACTED]',
  },
  // OAuth `?code=` / `&code=` — prose "code" with no `=` is left alone.
  { pattern: /([?&]code=)[^\s"'&#,}\])]+/gi, replacement: '$1[REDACTED]' },
  // `Cookie:` / `Set-Cookie:` header values carrying a `name=value` pair.
  // The name excludes `:` (never valid in a cookie name), so a failed match
  // stops at the next `Cookie:` — `"Cookie:".repeat(28571)` was quadratic.
  {
    pattern: /\b((?:Set-)?Cookie:)\s*[^\s=;:]+=[^\r\n]*/gi,
    replacement: '$1 [REDACTED]',
  },
];

/**
 * Redact a keyed match: keep the key and its `=` (or `:`), redact the value.
 */
function redactKeyedMatch(match: string): string {
  const eqIndex = match.indexOf('=');
  if (eqIndex !== -1) return match.substring(0, eqIndex + 1) + '[REDACTED]';
  const colonIndex = match.indexOf(':');
  if (colonIndex !== -1) {
    return match.substring(0, colonIndex + 1) + ' [REDACTED]';
  }
  return '[REDACTED]';
}

/**
 * Scrub sensitive values from log content: shaped rules first, then the
 * keyed `key=value` / `Key: value` patterns.
 */
export function scrubLogContent(content: string): string {
  let result = content;
  for (const rule of SHAPED_SCRUB_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  for (const pattern of KEYED_SCRUB_PATTERNS) {
    result = result.replace(pattern, redactKeyedMatch);
  }
  return result;
}
