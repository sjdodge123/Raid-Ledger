import { BadRequestException, type PipeTransform } from '@nestjs/common';
import {
  HubMediaHideBodySchema,
  HubMediaListQuerySchema,
  HubMediaVariantSchema,
  type HubMediaHideBody,
  type HubMediaListQuery,
  type HubMediaVariant,
} from '@raid-ledger/contract';

/** Positive int path param (400 otherwise). */
export class HubMediaIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new BadRequestException('Invalid id');
    }
    return n;
  }
}

export class HubMediaListQueryPipe implements PipeTransform<
  unknown,
  HubMediaListQuery
> {
  transform(value: unknown): HubMediaListQuery {
    const parsed = HubMediaListQuerySchema.safeParse(value ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid query');
    return parsed.data;
  }
}

export class HubMediaHideBodyPipe implements PipeTransform<
  unknown,
  HubMediaHideBody
> {
  transform(value: unknown): HubMediaHideBody {
    const parsed = HubMediaHideBodySchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Expected { hidden }');
    return parsed.data;
  }
}

export class HubMediaVariantPipe implements PipeTransform<
  unknown,
  HubMediaVariant
> {
  transform(value: unknown): HubMediaVariant {
    const parsed = HubMediaVariantSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid variant');
    return parsed.data;
  }
}
