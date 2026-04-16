import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('stats:attendance'), label: 'Attendance' },
  { customId: aiCustomId('stats:activity'), label: 'Activity' },
  { customId: aiCustomId('stats:guild-health'), label: 'Guild Health' },
];

/** Stats sub-menu. */
function statsMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'Which stats would you like to see?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Handle "Stats" tree path. Operator-only. */
export async function handleStats(
  path: string,
  deps: AiChatDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'stats') return statsMenu();
  if (path === 'stats:attendance') return fetchAttendance(deps);
  if (path === 'stats:activity') return fetchActivity();
  if (path === 'stats:guild-health') return fetchGuildHealth();
  return statsMenu();
}

/** Fetch attendance trends for the last 30 days. */
async function fetchAttendance(deps: AiChatDeps): Promise<TreeResult> {
  try {
    const trends = await deps.analyticsService.getAttendanceTrends('30d');
    return leaf(
      JSON.stringify(trends),
      null,
      'Summarize these attendance trends briefly.',
    );
  } catch {
    return leaf(null, 'Unable to fetch attendance stats.');
  }
}

/** Fetch game activity data. */
function fetchActivity(): TreeResult {
  return leaf(null, 'Activity stats coming soon.');
}

/** Fetch guild health overview. */
function fetchGuildHealth(): TreeResult {
  return leaf(null, 'Guild health stats coming soon.');
}

/** Helper to build a leaf result. */
function leaf(
  data: string | null,
  emptyMessage: string | null,
  systemHint?: string,
): TreeResult {
  return { data, emptyMessage, buttons: [], isLeaf: true, systemHint };
}
