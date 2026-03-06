import type {
  TimeSuggestion,
  EventPlanResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

export interface PollAnswerResult {
  totalVotes: number;
  registeredVotes: number;
  registeredVoterIds: string[];
}

/** Determines the winning option index from poll results. */
export function determineWinner(
  results: Map<number, PollAnswerResult>,
  options: Array<{ date: string; label: string }>,
  noneIndex: number,
): number | null {
  let bestIndex: number | null = null;
  let bestVotes = 0;
  let bestDate = Infinity;
  for (const [idx, result] of results.entries()) {
    if (idx === noneIndex || idx >= options.length) continue;
    const votes = result.registeredVotes;
    const d = new Date(options[idx].date).getTime();
    if (votes > bestVotes || (votes === bestVotes && d < bestDate)) {
      bestIndex = idx;
      bestVotes = votes;
      bestDate = d;
    }
  }
  return bestIndex;
}

/** Computes total roster slots from a slot config. */
export function computeTotalRosterSlots(slotConfig: unknown): number {
  if (!slotConfig || typeof slotConfig !== 'object') return 0;
  const config = slotConfig as Record<string, unknown>;
  if (config.type === 'mmo') {
    return (
      (Number(config.tank) || 0) +
      (Number(config.healer) || 0) +
      (Number(config.dps) || 0) +
      (Number(config.flex) || 0) +
      (Number(config.bench) || 0)
    );
  }
  if (config.type === 'generic') {
    return (Number(config.player) || 0) + (Number(config.bench) || 0);
  }
  return 0;
}

/** Finds the next occurrence of a day-of-week/hour after the cursor. */
function findNextOccurrence(jsDow: number, hour: number, after: Date): Date {
  const cursor = new Date(after);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(hour);
  while (cursor.getDay() !== jsDow || cursor <= after) {
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(hour, 0, 0, 0);
  }
  return cursor;
}

/** Formats a date into a human-readable label. */
function formatLabel(date: Date, timezone?: string): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/** Maps ranked availability cells to concrete date suggestions. */
export function mapToConcreteDates(
  ranked: Array<[string, number]>,
  _tzOffset: number,
  after: Date,
  daysAhead: number,
  timezone?: string,
): TimeSuggestion[] {
  const suggestions: TimeSuggestion[] = [];
  const endDate = new Date(after.getTime() + daysAhead * 24 * 3600 * 1000);
  for (const [key, count] of ranked) {
    const [dow, hour] = key.split(':').map(Number);
    const cursor = findNextOccurrence((dow + 1) % 7, hour, after);
    while (cursor < endDate) {
      suggestions.push({
        date: cursor.toISOString(),
        label: formatLabel(cursor, timezone),
        availableCount: count,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  }
  suggestions.sort((a, b) => {
    if (b.availableCount !== a.availableCount)
      return b.availableCount - a.availableCount;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
  return suggestions;
}

/** Generates fallback evening suggestions when no availability data exists. */
export function generateFallbackSuggestions(
  _tzOffset: number,
  after: Date,
  timezone?: string,
): TimeSuggestion[] {
  const suggestions: TimeSuggestion[] = [];
  const hours = [18, 19, 20, 21];
  for (let dayOff = 0; dayOff < 7; dayOff++) {
    for (const hour of hours) {
      const date = new Date(after);
      date.setDate(date.getDate() + dayOff + 1);
      date.setHours(hour, 0, 0, 0);
      if (date <= after) continue;
      suggestions.push({
        date: date.toISOString(),
        label: formatLabel(date, timezone),
        availableCount: 0,
      });
    }
  }
  return suggestions;
}

/** Maps a plan DB row to an EventPlanResponseDto. */
export function toResponseDto(
  plan: typeof schema.eventPlans.$inferSelect,
): EventPlanResponseDto {
  return {
    id: plan.id,
    creatorId: plan.creatorId,
    title: plan.title,
    description: plan.description,
    gameId: plan.gameId,
    slotConfig: plan.slotConfig as EventPlanResponseDto['slotConfig'],
    maxAttendees: plan.maxAttendees,
    autoUnbench: plan.autoUnbench,
    durationMinutes: plan.durationMinutes,
    pollOptions: plan.pollOptions as EventPlanResponseDto['pollOptions'],
    pollDurationHours: plan.pollDurationHours,
    pollMode: plan.pollMode as EventPlanResponseDto['pollMode'],
    pollRound: plan.pollRound,
    pollChannelId: plan.pollChannelId,
    pollMessageId: plan.pollMessageId,
    status: plan.status as EventPlanResponseDto['status'],
    winningOption: plan.winningOption,
    createdEventId: plan.createdEventId,
    pollStartedAt: plan.pollStartedAt?.toISOString() ?? null,
    pollEndsAt: plan.pollEndsAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** Formats a duration in minutes to a human-readable string. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  return hours > 0 ? `${hours}h` : `${mins}m`;
}

/** Builds the time options section of the poll embed. */
function buildTimeOptionsSection(
  options: Array<{ date: string; label: string }>,
): string[] {
  if (options.length === 0) return [];
  const lines = ['', '\u{1F4C6} **Time Options:**'];
  for (const opt of options) {
    const unix = Math.floor(new Date(opt.date).getTime() / 1000);
    lines.push(`> <t:${unix}:f> (<t:${unix}:R>)`);
  }
  return lines;
}

/** Builds the roster section of the poll embed. */
function buildRosterSection(
  slotConfig: Record<string, number | string>,
): string[] {
  if (slotConfig.type === 'mmo') {
    const tankMax = Number(slotConfig.tank) || 0;
    const healerMax = Number(slotConfig.healer) || 0;
    const dpsMax = Number(slotConfig.dps) || 0;
    const totalMax =
      tankMax + healerMax + dpsMax + (Number(slotConfig.flex) || 0);
    const parts = [`\u2500\u2500 ROSTER: 0/${totalMax} \u2500\u2500`];
    if (tankMax > 0) parts.push(`\u{1F6E1}\uFE0F Tanks (0/${tankMax}): \u2014`);
    if (healerMax > 0) parts.push(`\u{1F49A} Healers (0/${healerMax}): \u2014`);
    if (dpsMax > 0) parts.push(`\u2694\uFE0F DPS (0/${dpsMax}): \u2014`);
    return ['', parts.join('\n')];
  }
  if (slotConfig.player) {
    return [
      '',
      `\u2500\u2500 ROSTER: 0/${Number(slotConfig.player) || 0} \u2500\u2500`,
    ];
  }
  return [];
}

type PollEmbedDetails = {
  description?: string | null;
  gameName?: string | null;
  durationMinutes?: number;
  slotConfig?: Record<string, unknown> | null;
  pollMode?: string;
};

/** Appends the poll-close countdown line if applicable. */
function appendPollCloseLine(lines: string[], hours?: number): void {
  if (!hours) return;
  const unix = Math.floor((Date.now() + hours * 3600 * 1000) / 1000);
  lines.push('', `\u23F3 **Poll closes:** <t:${unix}:f> (<t:${unix}:R>)`);
}

/** Builds the full body lines for a poll embed message. */
export function buildPollEmbedBody(
  options: Array<{ date: string; label: string }>,
  details?: PollEmbedDetails,
  pollDurationHours?: number,
): string[] {
  const lines: string[] = [];
  if (details?.gameName) lines.push(`\u{1F3AE} **${details.gameName}**`);
  if (details?.durationMinutes)
    lines.push(
      `\u23F1\uFE0F **Duration:** ${formatDuration(details.durationMinutes)}`,
    );
  lines.push(...buildTimeOptionsSection(options));
  if (details?.slotConfig)
    lines.push(
      ...buildRosterSection(
        details.slotConfig as Record<string, number | string>,
      ),
    );
  if (details?.description) lines.push('', details.description);
  if (details?.pollMode === 'all_or_nothing')
    lines.push(
      '',
      "\u{1F504} **All or Nothing** \u2014 re-polls if anyone can't make it",
    );
  appendPollCloseLine(lines, pollDurationHours);
  return lines;
}
