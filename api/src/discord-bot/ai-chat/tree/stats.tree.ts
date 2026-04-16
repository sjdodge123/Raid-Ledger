import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

/** Handle "Stats" tree path. Operator-only. */
export async function handleStats(
  path: string,
  deps: AiChatDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  session: TreeSession,
): Promise<TreeResult> {
  return fetchAttendanceTrends(deps);
}

/** Fetch attendance trends for the last 30 days. */
async function fetchAttendanceTrends(deps: AiChatDeps): Promise<TreeResult> {
  try {
    const trends = await deps.analyticsService.getAttendanceTrends('30d');
    const data = JSON.stringify(trends);
    return {
      data,
      emptyMessage: null,
      buttons: [],
      isLeaf: true,
      systemHint: 'Summarize these attendance trend statistics.',
    };
  } catch {
    return {
      data: null,
      emptyMessage: 'Unable to fetch stats right now.',
      buttons: [],
      isLeaf: true,
    };
  }
}
