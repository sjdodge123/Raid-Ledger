const DEFAULT_MAX_LENGTH = 2000;

/** Upper bound on strip passes; nested mentions shrink by one per pass. */
const MAX_STRIP_PASSES = 10;

/** Patterns to strip from LLM output for safety. */
const OUTPUT_STRIP_PATTERNS: RegExp[] = [
  /@everyone/g,
  /@here/g,
  /<@&\d+>/g,
  /https?:\/\/(www\.)?discord\.(gg|com\/invite)\/\S+/g,
];

/**
 * Sanitize LLM output by stripping dangerous Discord mentions
 * (@everyone, @here, role mentions) and invite URLs, then enforcing a
 * length cap.
 */
export function sanitizeOutput(
  text: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  let cleaned = stripPatterns(text);
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Strip every pattern repeatedly until the text stops changing, so a nested
 * `@every@everyoneone` cannot reassemble into `@everyone` after one pass.
 * Bounded by {@link MAX_STRIP_PASSES}; input still changing after that is
 * pathological nesting, so every `@` is dropped to make a mention impossible.
 */
function stripPatterns(text: string): string {
  let current = text;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    let next = current;
    for (const pattern of OUTPUT_STRIP_PATTERNS) {
      next = next.replace(pattern, '');
    }
    if (next === current) return next;
    current = next;
  }
  return current.replace(/@/g, '');
}
