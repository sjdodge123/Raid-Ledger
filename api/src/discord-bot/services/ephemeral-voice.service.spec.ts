/**
 * Unit tests for EphemeralVoiceService (ROK-1352) — the two non-negotiable
 * behaviors: never-delete-while-occupied (AC4) and persist-then-repoint
 * ordering (architect constraint #1).
 */
import { Test } from '@nestjs/testing';
import { EphemeralVoiceService } from './ephemeral-voice.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { ScheduledEventService } from './scheduled-event.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { VoiceAttendanceService } from './voice-attendance.service';
import * as discordOps from './ephemeral-voice.discord-ops';
import * as dbHelpers from './ephemeral-voice.db-helpers';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

const guild = { id: 'g1' } as never;

async function build(memberCount: number) {
  const client = {
    isConnected: jest.fn().mockReturnValue(true),
    getGuild: jest.fn().mockReturnValue(guild),
    getClientId: jest.fn().mockReturnValue('bot-id'),
  };
  const scheduledEvent = { updateScheduledEvent: jest.fn() };
  const voiceAttendance = { flushToDb: jest.fn().mockResolvedValue(undefined) };
  const embed = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    getEphemeralVoiceCategoryId: jest.fn().mockResolvedValue(null),
    getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
  };
  const module = await Test.createTestingModule({
    providers: [
      EphemeralVoiceService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: DiscordBotClientService, useValue: client },
      { provide: SettingsService, useValue: settings },
      { provide: ScheduledEventService, useValue: scheduledEvent },
      { provide: EmbedSyncQueueService, useValue: embed },
      { provide: VoiceAttendanceService, useValue: voiceAttendance },
    ],
  }).compile();
  jest
    .spyOn(discordOps, 'getChannelMemberCountFresh')
    .mockResolvedValue(memberCount);
  jest.spyOn(discordOps, 'deleteVoiceChannel').mockResolvedValue(true);
  jest.spyOn(dbHelpers, 'buildRepointData').mockResolvedValue({
    title: 't',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T01:00:00Z',
    signupCount: 0,
    game: null,
  });
  const clearSpy = jest
    .spyOn(dbHelpers, 'clearEphemeralChannelId')
    .mockResolvedValue(undefined);
  const createSpy = jest
    .spyOn(discordOps, 'createVoiceChannel')
    .mockResolvedValue('new-ch');
  const claimSpy = jest
    .spyOn(dbHelpers, 'claimEphemeralChannelId')
    .mockResolvedValue(true);
  const getNameSpy = jest
    .spyOn(discordOps, 'getEphemeralChannelName')
    .mockReturnValue('stale name');
  const renameSpy = jest
    .spyOn(discordOps, 'renameVoiceChannel')
    .mockResolvedValue(undefined);
  const seReconcileSpy = jest
    .spyOn(discordOps, 'reconcileScheduledEventName')
    .mockResolvedValue(true);
  return {
    service: module.get(EphemeralVoiceService),
    deleteSpy: discordOps.deleteVoiceChannel as jest.Mock,
    clearSpy,
    createSpy,
    claimSpy,
    getNameSpy,
    renameSpy,
    seReconcileSpy,
    voiceAttendance,
  };
}

const row = {
  id: 1,
  title: 't',
  gameId: null,
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-01-01T01:00:00Z',
  recurrenceGroupId: null,
  ephemeralVoiceEnabled: null,
  ephemeralVoiceChannelId: 'ch-1',
  privateVoice: null,
};

afterEach(() => jest.restoreAllMocks());

describe('destroyForEvent — never delete while occupied (AC4)', () => {
  it('skips delete when the channel still has members', async () => {
    const { service, deleteSpy, clearSpy } = await build(2);
    await service.destroyForEvent({ ...row });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('flushes attendance then deletes when empty', async () => {
    const { service, deleteSpy, clearSpy, voiceAttendance } = await build(0);
    await service.destroyForEvent({ ...row });
    expect(deleteSpy).toHaveBeenCalledWith(guild, 'ch-1');
    expect(clearSpy).toHaveBeenCalledWith(expect.anything(), 1);
    expect(voiceAttendance.flushToDb).toHaveBeenCalled();
  });

  it('does nothing when the event has no ephemeral channel', async () => {
    const { service, deleteSpy } = await build(0);
    await service.destroyForEvent({ ...row, ephemeralVoiceChannelId: null });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  // ROK-1352 (Codex review): cancel/delete must tear down even an occupied
  // channel, or it is orphaned once the event row is gone.
  it('force-deletes even when the channel is occupied', async () => {
    const { service, deleteSpy, clearSpy } = await build(3);
    await service.destroyForEvent({ ...row }, { force: true });
    expect(deleteSpy).toHaveBeenCalledWith(guild, 'ch-1');
    expect(clearSpy).toHaveBeenCalledWith(expect.anything(), 1);
  });
});

describe('createForEvent — claim guards overlapping scans (Codex review)', () => {
  const fresh = { ...row, ephemeralVoiceChannelId: null };

  it('deletes the just-created channel when another scan already claimed it', async () => {
    const { service, createSpy, deleteSpy, claimSpy } = await build(0);
    claimSpy.mockResolvedValue(false); // lost the race
    await service.createForEvent({ ...fresh });
    expect(createSpy).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith(guild, 'new-ch');
  });

  it('keeps the channel when the claim succeeds', async () => {
    const { service, createSpy, deleteSpy, claimSpy } = await build(0);
    claimSpy.mockResolvedValue(true);
    await service.createForEvent({ ...fresh });
    expect(createSpy).toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileNamesForEvent — in-flight name backfill', () => {
  const reconcileRow = { ...row, discordScheduledEventId: 'se-1' };

  it('renames channel (marker, no trailing "Event") + SE (with time) when names differ', async () => {
    const { service, getNameSpy, renameSpy, seReconcileSpy } = await build(0);
    getNameSpy.mockReturnValue('stale name'); // != computed "⏰ t"
    await service.reconcileNamesForEvent({ ...reconcileRow });
    expect(renameSpy).toHaveBeenCalledWith(
      guild,
      'ch-1',
      expect.stringMatching(/^⏰ t$/),
    );
    expect(seReconcileSpy).toHaveBeenCalledWith(
      guild,
      'se-1',
      expect.stringMatching(/^t · /),
    );
  });

  it('does NOT rename the channel when its current name already matches (no churn)', async () => {
    const { service, getNameSpy, renameSpy, seReconcileSpy } = await build(0);
    getNameSpy.mockReturnValue('⏰ t'); // already correct
    seReconcileSpy.mockResolvedValue(false); // SE also already matches
    await service.reconcileNamesForEvent({ ...reconcileRow });
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it('skips non-ephemeral events (no channel id) without touching Discord', async () => {
    const { service, getNameSpy, renameSpy, seReconcileSpy } = await build(0);
    await service.reconcileNamesForEvent({
      ...reconcileRow,
      ephemeralVoiceChannelId: null,
    });
    expect(getNameSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    expect(seReconcileSpy).not.toHaveBeenCalled();
  });

  it('swallows a channel-rename error (rate-limit) and still reconciles the SE', async () => {
    const { service, getNameSpy, renameSpy, seReconcileSpy } = await build(0);
    getNameSpy.mockReturnValue('stale name');
    renameSpy.mockRejectedValue(new Error('rate limited'));
    await expect(
      service.reconcileNamesForEvent({ ...reconcileRow }),
    ).resolves.toBeUndefined();
    expect(seReconcileSpy).toHaveBeenCalled();
  });
});

const rosterRow = (over: {
  assignedSlot?: string | null;
  status?: string;
  userDiscordId?: string | null;
  signupDiscordUserId?: string | null;
}) => ({
  assignedSlot: over.assignedSlot ?? 'dps',
  status: over.status ?? 'signed_up',
  userDiscordId: over.userDiscordId ?? null,
  signupDiscordUserId: over.signupDiscordUserId ?? null,
});

describe('syncVoiceAccess — reconcile against rostered allow-list (ROK-1386)', () => {
  it('bails (no reconcile) when the event is not private', async () => {
    const { service } = await build(0);
    jest
      .spyOn(dbHelpers, 'fetchEventForEphemeral')
      .mockResolvedValue({ ...row, privateVoice: null });
    const applySpy = jest
      .spyOn(discordOps, 'applyPrivateVoiceOverwrites')
      .mockResolvedValue(undefined);
    await service.syncVoiceAccess(1);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('bails when private but the channel is gone', async () => {
    const { service } = await build(0);
    jest.spyOn(dbHelpers, 'fetchEventForEphemeral').mockResolvedValue({
      ...row,
      privateVoice: true,
      ephemeralVoiceChannelId: null,
    });
    const applySpy = jest
      .spyOn(discordOps, 'applyPrivateVoiceOverwrites')
      .mockResolvedValue(undefined);
    await service.syncVoiceAccess(1);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('reconciles overwrites against the rostered set (adds + removes via builder)', async () => {
    const { service } = await build(0);
    jest.spyOn(dbHelpers, 'fetchEventForEphemeral').mockResolvedValue({
      ...row,
      privateVoice: true,
      ephemeralVoiceChannelId: 'ch-1',
    });
    jest.spyOn(dbHelpers, 'fetchRosterSignupRows').mockResolvedValue([
      rosterRow({ assignedSlot: 'dps', userDiscordId: 'keep' }),
      rosterRow({ assignedSlot: 'bench', userDiscordId: 'benched' }), // excluded
      rosterRow({
        assignedSlot: null,
        status: 'tentative',
        userDiscordId: 'tent',
      }),
      rosterRow({ status: 'declined', userDiscordId: 'nope' }), // excluded
    ]);
    const applySpy = jest
      .spyOn(discordOps, 'applyPrivateVoiceOverwrites')
      .mockResolvedValue(undefined);
    await service.syncVoiceAccess(1);
    // The full add-missing/remove-stale diff is applyPrivateVoiceOverwrites'
    // job (covered in discord-ops.spec) — here we assert the service hands it
    // the correctly-computed desired allow-list + bot id.
    expect(applySpy).toHaveBeenCalledWith(
      guild,
      'ch-1',
      new Set(['keep', 'tent']),
      'bot-id',
    );
  });
});

describe('enforceJoinGuard — private-event voice join-guard (ROK-1386)', () => {
  const privateEv = {
    ...row,
    privateVoice: true,
    ephemeralVoiceChannelId: 'ch-1',
  };

  it('disconnects a member who is not on the allow-list', async () => {
    const { service } = await build(0);
    jest
      .spyOn(dbHelpers, 'findEventByEphemeralChannel')
      .mockResolvedValue(privateEv);
    jest
      .spyOn(dbHelpers, 'fetchRosterSignupRows')
      .mockResolvedValue([rosterRow({ userDiscordId: 'allowed' })]);
    const disconnectSpy = jest
      .spyOn(discordOps, 'disconnectMember')
      .mockResolvedValue(true);
    await service.enforceJoinGuard('ch-1', 'intruder');
    expect(disconnectSpy).toHaveBeenCalledWith(guild, 'intruder');
  });

  it('leaves an allow-listed member connected', async () => {
    const { service } = await build(0);
    jest
      .spyOn(dbHelpers, 'findEventByEphemeralChannel')
      .mockResolvedValue(privateEv);
    jest
      .spyOn(dbHelpers, 'fetchRosterSignupRows')
      .mockResolvedValue([rosterRow({ userDiscordId: 'allowed' })]);
    const disconnectSpy = jest
      .spyOn(discordOps, 'disconnectMember')
      .mockResolvedValue(false);
    await service.enforceJoinGuard('ch-1', 'allowed');
    expect(disconnectSpy).not.toHaveBeenCalled();
  });

  it('is a no-op for a non-private channel', async () => {
    const { service } = await build(0);
    jest
      .spyOn(dbHelpers, 'findEventByEphemeralChannel')
      .mockResolvedValue({ ...row, privateVoice: null });
    const disconnectSpy = jest
      .spyOn(discordOps, 'disconnectMember')
      .mockResolvedValue(true);
    await service.enforceJoinGuard('ch-1', 'whoever');
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});
