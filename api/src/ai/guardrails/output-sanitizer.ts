const DEFAULT_MAX_LENGTH = 2000;

/** Patterns to strip from LLM output for safety. */
const OUTPUT_STRIP_PATTERNS: RegExp[] = [
  /@everyone/g,
  /@here/g,
  /https?:\/\/(www\.)?discord\.(gg|com\/invite)\/\S+/g,
];

/**
 * Sanitize LLM output by stripping dangerous Discord mentions
 * and invite URLs, then enforcing a length cap.
 */
export function sanitizeOutput(
  text: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  let cleaned = text;
  for (const pattern of OUTPUT_STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}
