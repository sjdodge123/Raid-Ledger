import type { AddonExportSection } from '@raid-ledger/contract';
import {
  bindToCharacter,
  type AddonBindingCharacter,
  type AddonBindingOptions,
  type AddonBindingPayload,
  type AddonBindingResult,
} from './addon-import.binding';

/** A decoded section's envelope as the paste binding reads it. */
export interface AddonBindingSection extends AddonBindingPayload {
  section: AddonExportSection;
  exportedAt: number;
}

/**
 * ROK-1737 (Codex P2) — the ONE section whose `who` the character row
 * follows: the `char` section when present (it is the character snapshot),
 * otherwise the newest `exportedAt` (ties → the earlier section).
 */
export function authoritativeSectionIndex(
  sections: AddonBindingSection[],
): number {
  const char = sections.findIndex((s) => s.section === 'char');
  if (char >= 0) return char;
  let newest = 0;
  sections.forEach((s, i) => {
    if (s.exportedAt > (sections[newest]?.exportedAt ?? s.exportedAt)) {
      newest = i;
    }
  });
  return newest;
}

/**
 * ROK-1737 (Codex P2) — bind EVERY section of a paste, not just the first,
 * so no section lands under an identity only another section proved.
 * All-or-nothing: errors from every section, in section order (the service
 * throws `errors[0]`, so a single-section paste behaves exactly as before).
 * Everything else — warnings and the character-row writes (diff / pinGuid /
 * setRuleset) — comes from the authoritative section alone, so the row never
 * takes an older section's class/level/ruleset. GUID confirm/repin and
 * ruleset confirm are unchanged (the decoder guarantees one GUID).
 */
export function bindEverySection(
  sections: AddonBindingSection[],
  character: AddonBindingCharacter,
  opts: AddonBindingOptions,
): AddonBindingResult {
  const results = sections.map((s) => bindToCharacter(s, character, opts));
  const lead = results[authoritativeSectionIndex(sections)];
  if (!lead) throw new Error('bindEverySection: a paste has ≥1 section');
  return { ...lead, errors: results.flatMap((r) => r.errors) };
}
