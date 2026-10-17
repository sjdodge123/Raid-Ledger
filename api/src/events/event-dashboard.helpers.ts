/**
 * Dashboard event mapping and roster metric helpers.
 */
import type * as schema from '../drizzle/schema';
import type {
  DashboardEventDto,
  EventResponseDto,
} from '@raid-ledger/contract';

export {
  queryDashboardData,
  queryUnconfirmedCounts,
  queryAssignmentCounts,
  queryAttendanceMetrics,
} from './event-dashboard-queries.helpers';

type SlotConfig = {
  type?: string;
  tank?: number;
  healer?: number;
  dps?: number;
  flex?: number;
  player?: number;
  bench?: number;
} | null;

type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

type RosterMetrics = {
  rosterFillPercent: number;
  missingRoles: string[];
  hasSlots: boolean;
};

/** Computes fill percentage from slot-based config. */
function computeSlotFill(
  slotConfig: NonNullable<SlotConfig>,
  assignments: Map<string, number>,
): { fill: number; missing: string[] } {
  const roles =
    slotConfig.type === 'mmo'
      ? (['tank', 'healer', 'dps', 'flex'] as const)
      : (['player'] as const);
  let totalSlots = 0;
  let filledSlots = 0;
  const missing: string[] = [];
  for (const role of roles) {
    const needed = slotConfig[role] ?? 0;
    if (needed === 0) continue;
    totalSlots += needed;
    const assigned = assignments.get(role) ?? 0;
    filledSlots += Math.min(assigned, needed);
    if (assigned < needed) missing.push(`${needed - assigned} ${role}`);
  }
  const fill =
    totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
  return { fill, missing };
}

/** Computes roster fill metrics from slot config or max attendees. */
export function computeRosterMetrics(
  slotConfig: SlotConfig,
  assignments: Map<string, number>,
  signupCount: number,
  maxAttendees: number | null,
): RosterMetrics {
  if (slotConfig) {
    const { fill, missing } = computeSlotFill(slotConfig, assignments);
    return { rosterFillPercent: fill, missingRoles: missing, hasSlots: true };
  }
  if (maxAttendees) {
    const fill = Math.round((signupCount / maxAttendees) * 100);
    return { rosterFillPercent: fill, missingRoles: [], hasSlots: true };
  }
  return { rosterFillPercent: 0, missingRoles: [], hasSlots: false };
}

/** Maps a single event row to a DashboardEventDto. */
function mapSingleDashboardEvent(
  row: EventRow,
  mapToResponse: (row: EventRow) => EventResponseDto,
  assignmentMap: Map<number, Map<string, number>>,
  unconfirmedMap: Map<number, number>,
): { event: DashboardEventDto; metrics: RosterMetrics; signupCount: number } {
  const base = mapToResponse(row);
  const signupCount = Number(row.signupCount);
  const slotConfig = row.events.slotConfig as SlotConfig;
  const assignments =
    assignmentMap.get(row.events.id) ?? new Map<string, number>();
  const metrics = computeRosterMetrics(
    slotConfig,
    assignments,
    signupCount,
    row.events.maxAttendees,
  );
  return {
    event: {
      ...base,
      rosterFillPercent: metrics.rosterFillPercent,
      unconfirmedCount: unconfirmedMap.get(row.events.id) ?? 0,
      missingRoles: metrics.missingRoles,
    },
    metrics,
    signupCount,
  };
}

/** Checks if an event has a roster gap (unfilled slots or under max). */
function hasRosterGap(
  row: EventRow,
  metrics: RosterMetrics,
  signupCount: number,
): boolean {
  if (metrics.hasSlots && metrics.missingRoles.length > 0) return true;
  if (!row.events.slotConfig && row.events.maxAttendees) {
    return signupCount < row.events.maxAttendees;
  }
  return false;
}

type DashboardResult = {
  dashboardEvents: DashboardEventDto[];
  totalSignups: number;
  averageFillRate: number;
  eventsWithRosterGaps: number;
};

/** Aggregates fill rate and gap stats from mapped events. */
function aggregateStats(
  mapped: {
    event: DashboardEventDto;
    metrics: RosterMetrics;
    signupCount: number;
    row: EventRow;
  }[],
): Omit<DashboardResult, 'dashboardEvents'> {
  let totalSignups = 0;
  let fillSum = 0;
  let withSlots = 0;
  let withGaps = 0;
  for (const m of mapped) {
    totalSignups += m.signupCount;
    if (m.metrics.hasSlots) {
      withSlots++;
      fillSum += m.metrics.rosterFillPercent;
    }
    if (hasRosterGap(m.row, m.metrics, m.signupCount)) withGaps++;
  }
  return {
    totalSignups,
    averageFillRate: withSlots > 0 ? Math.round(fillSum / withSlots) : 0,
    eventsWithRosterGaps: withGaps,
  };
}

/** Builds dashboard events with aggregate statistics. */
export function buildDashboardEvents(
  events: EventRow[],
  mapToResponse: (row: EventRow) => EventResponseDto,
  assignmentMap: Map<number, Map<string, number>>,
  unconfirmedMap: Map<number, number>,
): DashboardResult {
  const mapped = events.map((row) => {
    const result = mapSingleDashboardEvent(
      row,
      mapToResponse,
      assignmentMap,
      unconfirmedMap,
    );
    return { ...result, row };
  });
  return {
    dashboardEvents: mapped.map((m) => m.event),
    ...aggregateStats(mapped),
  };
}
