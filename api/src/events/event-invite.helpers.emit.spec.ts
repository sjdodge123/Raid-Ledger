/**
 * ROK-2290 operator ruling 2026-11-23 — invites keep the old rule: bell off
 * means no invite at all. The character-invite path (`emitMemberInvite`)
 * must NOT ask `NotificationService.create` for a hidden row
 * (`callerSendsDm`), so a `new_event` bell-off member gets no row and no DM.
 */
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { EventResponseDto } from '@raid-ledger/contract';
import { emitMemberInvite } from './event-invite.helpers';
import type { NotificationService } from '../notifications/notification.service';
import { MEMBER_INVITE_EVENTS } from '../discord-bot/discord-bot.constants';

const EVENT = { title: 'Raid', game: null } as unknown as EventResponseDto;

function deps(created: { id: string } | null) {
  const create = jest.fn().mockResolvedValue(created);
  const emit = jest.fn();
  return {
    create,
    emit,
    svc: { create } as unknown as NotificationService,
    emitter: { emit } as unknown as EventEmitter2,
  };
}

describe('emitMemberInvite — bell off means no invite (ROK-2290)', () => {
  it('asks create for a skipDiscord row WITHOUT callerSendsDm', async () => {
    const d = deps(null);
    await emitMemberInvite(
      d.svc,
      d.emitter,
      EVENT,
      7,
      { id: 42, username: 'u' },
      'Ann',
      '123',
    );
    const input = d.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      type: 'new_event',
      skipDiscord: true,
      userId: 42,
    });
    expect(input).not.toHaveProperty('callerSendsDm');
  });

  it('no row (bell off) → no invite DM event', async () => {
    const d = deps(null);
    await emitMemberInvite(
      d.svc,
      d.emitter,
      EVENT,
      7,
      { id: 42, username: 'u' },
      'Ann',
      '123',
    );
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('a row (bell on) → one invite DM event carrying its id', async () => {
    const d = deps({ id: 'n-9' });
    await emitMemberInvite(
      d.svc,
      d.emitter,
      EVENT,
      7,
      { id: 42, username: 'u' },
      'Ann',
      '123',
    );
    expect(d.emit).toHaveBeenCalledWith(
      MEMBER_INVITE_EVENTS.CREATED,
      expect.objectContaining({ notificationId: 'n-9', eventId: 7 }),
    );
  });
});
