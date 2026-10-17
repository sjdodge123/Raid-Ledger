/**
 * ROK-1593 D16: a saved game-time template changes Rule B (a fully booked
 * evening is only "away" against the hours the user plays), so the user's
 * synced away days are re-derived. `GameTimeService.saveTemplate` emits the
 * event after its transaction commits; decoupled by event so the users
 * module never drives the calendar queue's derive policy itself.
 *
 * Best effort: `emit` does not await listeners, so a queue failure is logged
 * here and never reaches the template save (the next sync derives anyway).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import {
  CALENDAR_READ_QUEUE,
  GAME_TIME_TEMPLATE_SAVED_EVENT,
} from '../calendar-sync.constants';
import { enqueueCalendarDerive } from './calendar-read.enqueue.helpers';

const logger = new Logger('CalendarTemplateSaved');

@Injectable()
export class CalendarTemplateSavedListener {
  constructor(
    @InjectQueue(CALENDAR_READ_QUEUE) private readonly queue: Queue,
  ) {}

  @OnEvent(GAME_TIME_TEMPLATE_SAVED_EVENT)
  async onTemplateSaved(payload: { userId: number }): Promise<void> {
    try {
      await enqueueCalendarDerive(this.queue, payload.userId);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'unknown';
      logger.warn(`derive enqueue after template save failed (${name})`);
    }
  }
}
