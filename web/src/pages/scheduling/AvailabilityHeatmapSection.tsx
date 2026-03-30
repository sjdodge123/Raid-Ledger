/**
 * Availability heatmap wrapper for the scheduling poll page (ROK-965).
 * Wraps the existing HeatmapGrid component with scheduling-specific test IDs.
 */
import type { JSX } from 'react';
import type { RosterAvailabilityResponse } from '@raid-ledger/contract';
import { HeatmapGrid } from '../../components/features/heatmap/HeatmapGrid';

interface AvailabilityHeatmapSectionProps {
  data: RosterAvailabilityResponse | undefined;
  isLoading: boolean;
}

/** Loading placeholder for the heatmap section. */
function HeatmapSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-4 bg-overlay rounded w-48" />
      <div className="h-32 bg-overlay rounded" />
    </div>
  );
}

/**
 * Section rendering the availability heatmap for match members.
 * Wraps HeatmapGrid with the data-testid attributes expected by smoke tests.
 */
export function AvailabilityHeatmapSection({
  data,
  isLoading,
}: AvailabilityHeatmapSectionProps): JSX.Element | null {
  if (isLoading) return <HeatmapSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Availability
      </h3>
      <div data-testid="heatmap-grid">
        <HeatmapGrid data={data} />
      </div>
    </div>
  );
}
