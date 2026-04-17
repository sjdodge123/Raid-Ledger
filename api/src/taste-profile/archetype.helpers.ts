import type { TasteProfileArchetype } from '@raid-ledger/contract';

export interface ArchetypeInputs {
  intensity: number;
  focus: number;
  breadth: number;
  consistency: number;
  coPlayPartners: number;
}

/**
 * Derive a player archetype from their intensity metrics (ROK-948 AC 7).
 * Rules evaluate top-to-bottom — first match wins.
 */
export function deriveArchetype(
  inputs: ArchetypeInputs,
): TasteProfileArchetype {
  const { intensity, focus, breadth, consistency, coPlayPartners } = inputs;

  if (intensity >= 75 && consistency >= 60) return 'Dedicated';
  if (focus >= 80) return 'Specialist';
  if (breadth >= 70 && focus < 50) return 'Explorer';
  if (intensity < 50 && coPlayPartners >= 3) return 'Social Drifter';
  return 'Casual';
}
