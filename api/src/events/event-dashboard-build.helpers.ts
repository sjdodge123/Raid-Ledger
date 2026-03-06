/**
 * Dashboard assembly helper -- combines query results into a DashboardResponseDto.
 */
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { DashboardResponseDto } from '@raid-ledger/contract';
import { mapEventToResponse } from './event-response.helpers';
import {
  queryDashboardData,
  queryUnconfirmedCounts,
  queryAssignmentCounts,
  queryAttendanceMetrics,
  buildDashboardEvents,
} from './event-dashboard.helpers';

const EMPTY_DASHBOARD: DashboardResponseDto = {
  stats: {
    totalUpcomingEvents: 0,
    totalSignups: 0,
    averageFillRate: 0,
    eventsWithRosterGaps: 0,
  },
  events: [],
};

/** Assembles a complete dashboard response for the given user. */
export async function assembleDashboard(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  isAdmin: boolean,
): Promise<DashboardResponseDto> {
  const { events, eventIds } = await queryDashboardData(db, userId, isAdmin);
  if (events.length === 0) return EMPTY_DASHBOARD;
  const [unconfirmedMap, assignmentMap, attendance] = await Promise.all([
    queryUnconfirmedCounts(db, eventIds),
    queryAssignmentCounts(db, eventIds),
    queryAttendanceMetrics(db, userId, isAdmin),
  ]);
  const result = buildDashboardEvents(
    events,
    (row) => mapEventToResponse(row),
    assignmentMap,
    unconfirmedMap,
  );
  return {
    stats: {
      totalUpcomingEvents: events.length,
      totalSignups: result.totalSignups,
      averageFillRate: result.averageFillRate,
      eventsWithRosterGaps: result.eventsWithRosterGaps,
      attendanceRate: attendance.attendanceRate,
      noShowRate: attendance.noShowRate,
    },
    events: result.dashboardEvents,
  };
}
