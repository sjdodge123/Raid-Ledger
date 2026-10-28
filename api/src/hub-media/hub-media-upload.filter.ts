import {
  Catch,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * ROK-1965 §6 — multer's own 413 (over the 9 MiB cap) carries no `code`;
 * give it `too_large` so the web maps it without string-matching. A 413 the
 * service built (`cap`) keeps its code.
 */
@Catch(PayloadTooLargeException)
export class HubMediaUploadTooLargeFilter implements ExceptionFilter {
  catch(err: PayloadTooLargeException, host: ArgumentsHost): void {
    const body = err.getResponse();
    const fields: Record<string, unknown> =
      typeof body === 'object' ? { ...body } : { message: body };
    const json =
      'code' in fields
        ? fields
        : {
            ...fields,
            code: 'too_large',
            message: 'That picture is too big (max 9 MB).',
          };
    host.switchToHttp().getResponse<Response>().status(413).json(json);
  }
}
