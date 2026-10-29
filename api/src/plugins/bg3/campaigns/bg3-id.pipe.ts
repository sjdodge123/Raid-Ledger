import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const Bg3IdSchema = z.coerce.number().int().min(1).max(2147483647);

/** ROK-1957 — a positive int4 route id (hub, campaign) or 400. */
export class Bg3IdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const parsed = Bg3IdSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid id');
    return parsed.data;
  }
}

export const bg3IdPipe = new Bg3IdPipe();
