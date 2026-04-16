import { aiCustomId } from '../ai-chat.constants';
import type { TreeResult, AiChatDeps, TreeSession } from './tree.types';

const SUB_BUTTONS = [
  { customId: aiCustomId('events:this-week'), label: 'This Week' },
  { customId: aiCustomId('events:next-week'), label: 'Next Week' },
  { customId: aiCustomId('events:search'), label: 'Search by Game' },
];

/** Events sub-menu — lists child options. */
function eventsMenu(): TreeResult {
  return {
    data: null,
    emptyMessage: 'What would you like to know about events?',
    buttons: SUB_BUTTONS,
    isLeaf: false,
  };
}

/** Fetch events for a date range and return a tree result. */
async function eventsForRange(
  deps: AiChatDeps,
  startDate: Date,
  endDate: Date,
  emptyMsg: string,
): Promise<TreeResult> {
  const result = await deps.eventsService.findAll({
    startAfter: startDate.toISOString(),
    endBefore: endDate.toISOString(),
    page: 1,
    limit: 20,
  });
  const events = result.data ?? [];
  if (events.length === 0) {
    return { data: null, emptyMessage: emptyMsg, buttons: [], isLeaf: true };
  }
  const summary = events
    .map((e) => `${e.title} — ${new Date(e.startTime).toLocaleDateString()}`)
    .join('\n');
  const buttons = deps.clientUrl
    ? [
        {
          customId: 'noop',
          label: 'View Events',
          style: 'link' as const,
          url: `${deps.clientUrl}/events`,
        },
      ]
    : [];
  return {
    data: summary,
    emptyMessage: null,
    buttons,
    isLeaf: true,
    systemHint: 'Summarize these upcoming events for the user.',
  };
}

/** Build date range for "this week" (today through end of Sunday). */
function thisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  const daysUntilSunday = (7 - start.getDay()) % 7 || 7;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Build date range for "next week". */
function nextWeekRange(): { start: Date; end: Date } {
  const { end: thisEnd } = thisWeekRange();
  const start = new Date(thisEnd);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Main events tree handler. */
export async function handleEvents(
  path: string,
  deps: AiChatDeps,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  session: TreeSession,
): Promise<TreeResult> {
  if (path === 'events') return eventsMenu();
  if (path === 'events:this-week') {
    const { start, end } = thisWeekRange();
    return eventsForRange(deps, start, end, 'No events scheduled this week.');
  }
  if (path === 'events:next-week') {
    const { start, end } = nextWeekRange();
    return eventsForRange(deps, start, end, 'No events scheduled next week.');
  }
  if (path === 'events:search') {
    return {
      data: null,
      emptyMessage: 'Type a game name to search for events.',
      buttons: [],
      isLeaf: false,
    };
  }
  return eventsMenu();
}
