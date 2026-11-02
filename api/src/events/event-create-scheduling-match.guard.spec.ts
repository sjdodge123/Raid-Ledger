import { BadRequestException } from '@nestjs/common';
import type { CreateEventDto } from '@raid-ledger/contract';
import { rejectSchedulingMatchOnCreate } from './event-create-scheduling-match.guard';

const DTO = {
  title: 'Game night',
  startTime: '2026-11-10T20:00:00.000Z',
  endTime: '2026-11-10T22:00:00.000Z',
} as CreateEventDto;

describe('rejectSchedulingMatchOnCreate (ROK-2039)', () => {
  it('lets a plain create through', () => {
    expect(() => rejectSchedulingMatchOnCreate(DTO)).not.toThrow();
  });

  it('400s a create carrying schedulingMatchId and names the lock-in route', () => {
    const run = (): void =>
      rejectSchedulingMatchOnCreate({ ...DTO, schedulingMatchId: 42 });
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow('/scheduling-polls/42/lock-in');
  });
});
