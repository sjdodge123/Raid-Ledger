import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PutHubSessionNoteSchema,
  TickHubSessionNoteItemSchema,
  type HubSessionNote,
  type HubSessionNoteResponse,
  type PutHubSessionNoteInput,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { GuildAccessService, type GuildActor } from '../guild-access.service';
import { toPerson } from '../posts/hub-posts.helpers';
import { parseOrThrow } from '../posts/hub-posts.service.helpers';
import {
  isNoteExpired,
  noteBody,
  planItemRewrite,
  toClearAfter,
  toNoteItem,
  type PinnedEventRow,
} from './hub-session-note.helpers';
import {
  deleteExpiredNote,
  deleteNote,
  findItemIds,
  findItems,
  findNextHubEvent,
  findNote,
  findPinnedEvent,
  insertNote,
  lockNote,
  rewriteItems,
  tickItem,
  updateNote,
  type Db,
  type DbOrTx,
  type NoteRecord,
} from './hub-session-note.queries';

/** A locked, not-expired note inside an editor save. */
interface LockedNote {
  updatedAt: string;
  pin: PinnedEventRow | null;
}

type WriteOutcome = 'ok' | 'conflict';

const NO_NEXT_EVENT = {
  clearAfterNextEvent: ['No upcoming event to clear after'],
};

/**
 * ROK-1968 §5 — the hub's "Before next session" note (Core widget). Reads and
 * ticks need `canView` (404 otherwise: members only, ruling 3); saves and
 * clears arrive behind `GuildEditorGuard` (ruling 2). Auto-clear is lazy
 * (ruling 4b): every read/write first drops a note whose pinned event ended.
 */
@Injectable()
export class HubSessionNoteService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  async get(
    actor: GuildActor,
    guildId: number,
  ): Promise<HubSessionNoteResponse> {
    await this.assertViewable(actor, guildId);
    return this.respond(actor, guildId);
  }

  /** D8 editor save: 409 with the current note on a stale `baseUpdatedAt`. */
  async save(
    actor: GuildActor,
    guildId: number,
    input: unknown,
  ): Promise<HubSessionNoteResponse> {
    const parsed = parseOrThrow(PutHubSessionNoteSchema, input);
    const body = noteBody(parsed.body, parsed.items.length);
    const outcome = await this.db.transaction((tx) =>
      this.write(tx, actor.id, guildId, { ...parsed, body }),
    );
    const response = await this.respond(actor, guildId);
    if (outcome === 'conflict') {
      throw new ConflictException({
        message: 'Note changed',
        note: response.note,
      });
    }
    return response;
  }

  /** Idempotent: 204 whether or not a note existed. */
  async clear(guildId: number): Promise<void> {
    await deleteNote(this.db, guildId);
  }

  /** D4: members tick/untick; never touches the note's `updated_at` (A-4). */
  async tick(
    actor: GuildActor,
    guildId: number,
    itemId: number,
    input: unknown,
  ): Promise<HubSessionNoteResponse> {
    await this.assertViewable(actor, guildId);
    const { done } = parseOrThrow(TickHubSessionNoteItemSchema, input);
    const live = await this.loadLive(guildId, new Date());
    const ticked =
      live !== null &&
      (await tickItem(this.db, guildId, itemId, done, actor.id));
    if (!ticked) throw new NotFoundException('Checklist item not found');
    return this.respond(actor, guildId);
  }

  private async write(
    tx: DbOrTx,
    actorId: number,
    guildId: number,
    input: PutHubSessionNoteInput,
  ): Promise<WriteOutcome> {
    const now = new Date();
    const locked = await this.lockLive(tx, guildId, now);
    if ((locked?.updatedAt ?? null) !== input.baseUpdatedAt) return 'conflict';
    const write = {
      guildId,
      body: input.body,
      actorId,
      clearAfterEventId: await this.resolvePin(tx, guildId, input, locked, now),
    };
    if (locked !== null) await updateNote(tx, write);
    else if (!(await insertNote(tx, write))) return 'conflict';
    const plan = planItemRewrite(await findItemIds(tx, guildId), input.items);
    await rewriteItems(tx, guildId, plan);
    return 'ok';
  }

  /** Ruling 4a/4d: pin the next event, but keep a still-live existing pin. */
  private async resolvePin(
    tx: DbOrTx,
    guildId: number,
    input: PutHubSessionNoteInput,
    locked: LockedNote | null,
    now: Date,
  ): Promise<number | null> {
    if (!input.clearAfterNextEvent) return null;
    const kept = locked?.pin;
    if (kept && kept.cancelledAt === null) return kept.id;
    const next = await findNextHubEvent(tx, guildId, now);
    if (next === null) throw new BadRequestException(NO_NEXT_EVENT);
    return next.id;
  }

  /** `SELECT … FOR UPDATE`, then treat an expired note as absent (deleted). */
  private async lockLive(
    tx: DbOrTx,
    guildId: number,
    now: Date,
  ): Promise<LockedNote | null> {
    const lock = await lockNote(tx, guildId);
    if (lock === null) return null;
    const pin = await findPinnedEvent(tx, lock.clearAfterEventId);
    if (!isNoteExpired(pin, now)) return { updatedAt: lock.updatedAt, pin };
    if (pin) await deleteExpiredNote(tx, guildId, pin.id);
    return null;
  }

  /** The note, or null when absent or (lazily deleted) expired. */
  private async loadLive(
    guildId: number,
    now: Date,
  ): Promise<{ note: NoteRecord; pin: PinnedEventRow | null } | null> {
    const note = await findNote(this.db, guildId);
    if (note === null) return null;
    const pin = await findPinnedEvent(this.db, note.clearAfterEventId);
    if (!isNoteExpired(pin, now)) return { note, pin };
    if (pin) await deleteExpiredNote(this.db, guildId, pin.id);
    return null;
  }

  private async respond(
    actor: GuildActor,
    guildId: number,
  ): Promise<HubSessionNoteResponse> {
    const now = new Date();
    const canEdit = await this.access.canEdit(actor, guildId);
    const canTick = canEdit || (await this.access.canView(actor, guildId));
    const live = await this.loadLive(guildId, now);
    const next = canEdit ? await findNextHubEvent(this.db, guildId, now) : null;
    return {
      note: live === null ? null : await this.toNote(guildId, live),
      viewer: { canEdit, canTick },
      nextEvent: toClearAfter(next),
    };
  }

  private async toNote(
    guildId: number,
    live: { note: NoteRecord; pin: PinnedEventRow | null },
  ): Promise<HubSessionNote> {
    const items = await findItems(this.db, guildId);
    return {
      body: live.note.body,
      items: items.map(toNoteItem),
      updatedAt: live.note.updatedAt,
      updatedBy: live.note.editor === null ? null : toPerson(live.note.editor),
      clearAfter: toClearAfter(live.pin),
    };
  }

  /** Ruling 3: visitors (and non-members) get 404, like the Gallery. */
  private async assertViewable(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new NotFoundException('Hub not found');
    }
  }
}
