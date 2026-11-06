/**
 * Tech debt (2026-10 security backlog): a PATCH carrying only one bound used
 * to skip the start<end check and the 24h cap the create path enforces, so
 * the merged range could be endless or inverted (a tsrange 500).
 */
import { BadRequestException } from '@nestjs/common';
import type { AvailabilityDto } from '@raid-ledger/contract';
import { buildUpdateData } from './availability.helpers';

const existing: AvailabilityDto = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: 1,
  timeRange: {
    start: '2026-11-06T10:00:00.000Z',
    end: '2026-11-06T12:00:00.000Z',
  },
  status: 'available',
  gameId: null,
  sourceEventId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('buildUpdateData — merged range validation', () => {
  it('rejects only a start sent past the existing end', () => {
    expect(() =>
      buildUpdateData(existing, { startTime: '2026-11-06T13:00:00.000Z' }),
    ).toThrow(new BadRequestException('End time must be after start time'));
  });

  it('rejects a start equal to the existing end', () => {
    expect(() =>
      buildUpdateData(existing, { startTime: '2026-11-06T12:00:00.000Z' }),
    ).toThrow(BadRequestException);
  });

  it('rejects only an end sent that stretches the window past 24 hours', () => {
    expect(() =>
      buildUpdateData(existing, { endTime: '2026-11-07T11:00:00.000Z' }),
    ).toThrow(
      new BadRequestException('Availability window cannot exceed 24 hours'),
    );
  });

  it('rejects both bounds sent spanning more than 24 hours', () => {
    expect(() =>
      buildUpdateData(existing, {
        startTime: '2026-11-06T00:00:00.000Z',
        endTime: '2026-11-07T00:00:01.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid single-bound update and merges the range', () => {
    const { updateData, newStartTime, newEndTime } = buildUpdateData(existing, {
      endTime: '2026-11-06T14:00:00.000Z',
    });
    expect(newStartTime).toBe(existing.timeRange.start);
    expect(newEndTime).toBe('2026-11-06T14:00:00.000Z');
    expect(updateData.timeRange).toEqual([
      new Date('2026-11-06T10:00:00.000Z'),
      new Date('2026-11-06T14:00:00.000Z'),
    ]);
  });

  it('accepts an exactly-24-hour window', () => {
    expect(() =>
      buildUpdateData(existing, { endTime: '2026-11-07T10:00:00.000Z' }),
    ).not.toThrow();
  });

  it('does not validate when no bound is sent (status-only update)', () => {
    const { updateData } = buildUpdateData(existing, { status: 'blocked' });
    expect(updateData.timeRange).toBeUndefined();
    expect(updateData.status).toBe('blocked');
  });
});
