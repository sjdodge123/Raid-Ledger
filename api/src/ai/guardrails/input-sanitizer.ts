/** Known prompt injection patterns (case-insensitive). */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /disregard\s+(all\s+)?(prior|previous)\s+instructions?/gi,
  /override\s+system\s+prompt/gi,
  /system\s+prompt/gi,
  /you\s+are\s+now/gi,
  /forget\s+(all\s+)?(prior|previous)\s+instructions?/gi,
  /new\s+instructions?:\s*/gi,
  /\[system\]/gi,
  /\[inst\]/gi,
  /<<sys>>/gi,
  /<\|im_start\|>/gi,
];

/**
 * Sanitize user input by stripping known prompt injection patterns.
 * Returns the cleaned text with collapsed whitespace.
 */
export function sanitizeInput(text: string): string {
  let cleaned = text;
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Check if text contains any known injection patterns.
 * Useful for logging/flagging without modifying the text.
 */
export function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
