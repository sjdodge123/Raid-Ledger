/**
 * Full-lifecycle orchestrators for the four notifications gated by
 * visibility (ROK-1115). Each export wraps the shared shape:
 *   1. Build a LineupInfo from lineupId + caller-provided overrides.
 *   2. Short-circuit via the matching `route...IfPrivate` helper.
 *   3. Resolve the embed context.
 *   4. Post the channel embed + run any per-member DM fan-out.
 *
 * Extracted from LineupNotificationService to keep the orchestrator under
 * the 300-line ESLint ceiling once the private-routing branches landed.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { SettingsService } from '../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type {
  EmbedContext,
  EmbedWithRow,
  NominationEntry,
} from './lineup-notification-embed.helpers';
import {
  buildMilestoneEmbed,
  buildDecidedEmbed,
  buildSchedulingEmbed,
  buildEventCreatedEmbed,
} from './lineup-notification-embed.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from './lineup-notification-dispatch.helpers';
import {
  fanOutMatchMemberDMs,
  fanOutSchedulingDMs,
  fanOutEventCreatedDMs,
} from './lineup-notification-dm-batch.helpers';
import {
  findMatchMemberUsers,
  hasExistingPollEmbed,
} from './lineup-notification-targets.helpers';
import {
  routeNominationMilestoneIfPrivate,
  routeMatchesFoundIfPrivate,
  routeSchedulingOpenIfPrivate,
  routeEventCreatedIfPrivate,
} from './lineup-notification-routing.helpers';
import type { LineupInfo, MatchInfo } from './lineup-notification.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Composed deps the lifecycle orchestrators need. */
export interface OrchestrationDeps {
  db: Db;
  notificationService: NotificationService;
  dedupService: NotificationDedupService;
  botClient: DiscordBotClientService;
  settingsService: SettingsService;
}

function dispatchDeps(deps: OrchestrationDeps): DispatchDeps {
  const { db, settingsService, botClient, dedupService } = deps;
  return { db, settingsService, botClient, dedupService };
}

type BuildFn = (
  ctx: EmbedContext,
) => Promise<EmbedWithRow | null> | EmbedWithRow | null;

async function postEmbed(
  deps: OrchestrationDeps,
  dedupKey: string,
  build: BuildFn,
  ctx: EmbedContext,
): Promise<void> {
  await postChannelEmbed(dispatchDeps(deps), dedupKey, build, ctx);
}

/** AC-2: Milestone notification — gates on visibility, then posts embed. */
export async function orchestrateMilestone(
  deps: OrchestrationDeps,
  lineupId: number,
  threshold: number,
  entries: NominationEntry[],
  lineupInfo?: Partial<LineupInfo>,
): Promise<void> {
  const lineup: LineupInfo = { id: lineupId, ...lineupInfo };
  const routedPrivate = await routeNominationMilestoneIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    threshold,
    entries.length,
  );
  if (routedPrivate) return;
  const ctx = await resolveEmbedCtx(
    dispatchDeps(deps),
    lineupId,
    'nominations',
  );
  await postEmbed(
    deps,
    `lineup-milestone:${lineupId}:${threshold}`,
    () => buildMilestoneEmbed(ctx, threshold, entries),
    ctx,
  );
}

/** AC-5: Decided-tier notification — gates on visibility, then posts. */
export async function orchestrateMatchesFound(
  deps: OrchestrationDeps,
  lineupId: number,
  matches: MatchInfo[],
  lineupInfo?: Partial<LineupInfo>,
): Promise<void> {
  const lineup: LineupInfo = { id: lineupId, ...lineupInfo };
  const routedPrivate = await routeMatchesFoundIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    matches.length,
  );
  if (routedPrivate) return;
  const ctx = await resolveEmbedCtx(dispatchDeps(deps), lineupId, 'decided');
  await postEmbed(
    deps,
    `lineup-decided:${lineupId}`,
    () => buildDecidedEmbed(ctx, matches),
    ctx,
  );
  await fanOutMatchMemberDMs(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineupId,
    matches,
  );
}

/** Build the scheduling-embed builder bound to a match + ctx. */
function schedulingBuilder(
  deps: OrchestrationDeps,
  match: MatchInfo,
  ctx: EmbedContext,
): BuildFn {
  return async () => {
    if (await hasExistingPollEmbed(deps.db, match.id)) return null;
    return buildSchedulingEmbed(ctx, match.gameName, match.id);
  };
}

/** AC-8: Scheduling-open notification — gates on visibility, then posts. */
export async function orchestrateSchedulingOpen(
  deps: OrchestrationDeps,
  match: MatchInfo,
  lineupInfo?: Partial<LineupInfo>,
): Promise<void> {
  const lineup: LineupInfo = { id: match.lineupId, ...lineupInfo };
  const routedPrivate = await routeSchedulingOpenIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    match,
  );
  if (routedPrivate) return;
  const ctx = await resolveEmbedCtx(
    dispatchDeps(deps),
    match.lineupId,
    'decided',
  );
  await postEmbed(
    deps,
    `lineup-scheduling:${match.id}`,
    schedulingBuilder(deps, match, ctx),
    ctx,
  );
  await fanOutSchedulingDMs(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    match,
  );
}

/** Build the event-created embed builder bound to a match, ctx, and members. */
function eventCreatedBuilder(
  match: MatchInfo,
  ctx: EmbedContext,
  eventDate: Date,
  eventId: number | undefined,
  members: Awaited<ReturnType<typeof findMatchMemberUsers>>,
): BuildFn {
  return () =>
    buildEventCreatedEmbed(
      ctx,
      match.gameName,
      match.gameId,
      eventDate,
      eventId,
      members.map((m) => m.displayName),
    );
}

/** AC-10: Event-created notification — gates on visibility, then posts. */
export async function orchestrateEventCreated(
  deps: OrchestrationDeps,
  match: MatchInfo,
  eventDate: Date,
  eventId: number | undefined,
  lineupInfo?: Partial<LineupInfo>,
): Promise<void> {
  const lineup: LineupInfo = { id: match.lineupId, ...lineupInfo };
  const routedPrivate = await routeEventCreatedIfPrivate(
    deps.db,
    deps.notificationService,
    deps.dedupService,
    lineup,
    match,
    eventDate,
    eventId,
  );
  if (routedPrivate) return;
  const members = await findMatchMemberUsers(deps.db, match.id);
  const ctx = await resolveEmbedCtx(
    dispatchDeps(deps),
    match.lineupId,
    'decided',
  );
  await postEmbed(
    deps,
    `lineup-event:${match.id}`,
    eventCreatedBuilder(match, ctx, eventDate, eventId, members),
    ctx,
  );
  await fanOutEventCreatedDMs(
    deps.notificationService,
    deps.dedupService,
    match,
    eventDate,
    eventId,
    members,
  );
}
