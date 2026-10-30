import {
  Catch,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * ROK-1814 — multer's own 413 (over the 1 MiB cap) carries no `code`; give
 * it `too_large` so the web maps it without string-matching.
 */
@Catch(PayloadTooLargeException)
export class HubCrestUploadTooLargeFilter implements ExceptionFilter {
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
            message: 'That picture is too big (max 1 MB).',
          };
    host.switchToHttp().getResponse<Response>().status(413).json(json);
  }
}
