/**
 * ROK-2107: professions provenance. `characters.professions` holds only what
 * the user entered (ROK-1130); `characters.armory_professions` holds only what
 * the Blizzard `/professions` sync wrote. This module is the ONE switch that
 * decides which of the two a reader sees — the character DTO and the WoW fact
 * precedence table both read it, so they cannot disagree.
 */
import {
  CharacterProfessionsSchema,
  type CharacterProfessionsDto,
} from '@raid-ledger/contract';

/**
 * Operator ruling F0 (2026-11-07): Blizzard wins — the Armory value is shown
 * when present, the hand entry is the fallback. Flip to `true` and a
 * hand-entered profession beats a fresh Blizzard value everywhere (as
 * `role_override` does).
 */
export const MANUAL_PROFESSIONS_WIN: boolean = false;

export type ProfessionsSource = 'manual' | 'blizzard';

export interface EffectiveProfessions {
  value: CharacterProfessionsDto | null;
  source: ProfessionsSource | null;
}

/** Parse a jsonb column value; anything malformed counts as absent. */
export function parseProfessions(raw: unknown): CharacterProfessionsDto | null {
  if (raw === null || raw === undefined) return null;
  const parsed = CharacterProfessionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The professions a reader sees, and where they came from. The winner per
 * {@link MANUAL_PROFESSIONS_WIN} is used when present, else the other one.
 */
export function effectiveProfessions(
  manualRaw: unknown,
  armoryRaw: unknown,
  manualWins: boolean = MANUAL_PROFESSIONS_WIN,
): EffectiveProfessions {
  const manual = parseProfessions(manualRaw);
  const armory = parseProfessions(armoryRaw);
  const ordered: [CharacterProfessionsDto | null, ProfessionsSource][] =
    manualWins
      ? [
          [manual, 'manual'],
          [armory, 'blizzard'],
        ]
      : [
          [armory, 'blizzard'],
          [manual, 'manual'],
        ];
  for (const [value, source] of ordered) {
    if (value !== null) return { value, source };
  }
  return { value: null, source: null };
}
