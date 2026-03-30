/**
 * Tier section wrapper with gradient header (ROK-989).
 * Renders a labelled section for each match tier:
 * Scheduling Now (cyan), Almost There (emerald), Rally Your Crew (amber).
 */
import type { JSX, ReactNode } from 'react';

/** Visual config for each tier. */
interface TierConfig {
  label: string;
  gradient: string;
  border: string;
}

/** Tier-level visual configurations keyed by tier name. */
const TIER_CONFIG: Record<string, TierConfig> = {
  scheduling: {
    label: 'Scheduling Now',
    gradient: 'from-cyan-500/20 to-transparent',
    border: 'border-cyan-500/30',
  },
  almostThere: {
    label: 'Almost There',
    gradient: 'from-emerald-500/20 to-transparent',
    border: 'border-emerald-500/30',
  },
  rallyYourCrew: {
    label: 'Rally Your Crew',
    gradient: 'from-amber-500/20 to-transparent',
    border: 'border-amber-500/30',
  },
};

interface MatchTierSectionProps {
  tier: string;
  children: ReactNode;
}

/** Wrapper section with tier-colored gradient header. */
export function MatchTierSection({
  tier,
  children,
}: MatchTierSectionProps): JSX.Element {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.scheduling;

  return (
    <section
      data-testid="match-tier-section"
      className={`rounded-xl border ${config.border} bg-gradient-to-b ${config.gradient} overflow-hidden`}
    >
      <div className="px-4 py-2.5 border-b border-edge/50">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">
          {config.label}
        </h3>
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </section>
  );
}
