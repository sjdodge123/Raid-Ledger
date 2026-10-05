import {
  bindToCharacter,
  type AddonBindingCharacter,
  type AddonBindingOptions,
  type AddonBindingPayload,
  type AddonBindingResult,
} from './addon-import.binding';

/**
 * ROK-1737 (Codex P2) — bind EVERY section of a paste, not just the first,
 * so no section lands under an identity only another section proved.
 * All-or-nothing: errors from every section, in section order (the service
 * throws `errors[0]`, so a single-section paste behaves exactly as before).
 * Warnings are de-duplicated across sections. The character-row writes
 * (diff / pinGuid / setRuleset) come from the first section — the one the
 * result's top level mirrors — so GUID confirm/repin semantics are
 * unchanged (the decoder guarantees every section shares the GUID).
 */
export function bindEverySection(
  payloads: AddonBindingPayload[],
  character: AddonBindingCharacter,
  opts: AddonBindingOptions,
): AddonBindingResult {
  const results = payloads.map((p) => bindToCharacter(p, character, opts));
  const [head] = results;
  if (!head) throw new Error('bindEverySection: a paste has ≥1 section');
  const seen = new Set<string>();
  const warnings = results
    .flatMap((r) => r.warnings)
    .filter((w) => {
      const key = JSON.stringify(w);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { ...head, errors: results.flatMap((r) => r.errors), warnings };
}
