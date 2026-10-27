import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  assertDeclaredLength as assertSharedDeclaredLength,
  assertMediaType,
  headerOf as sharedHeaderOf,
  readBoundedBody as readSharedBoundedBody,
  type BoundedBodyErrors,
} from '../../../../common/bounded-body/bounded-body.reader';
import { ingestError } from '../valheim-link-request';
import {
  VALHEIM_LINK_CONTENT_TYPE,
  type ValheimLinkBypassedRequest,
} from './valheim-link-body-bypass';

/**
 * Valheim Link's binding of the shared bounded body reader
 * (`common/bounded-body`, ROK-1956): Valheim error bodies and the Valheim
 * body-parser bypass. Exports are unchanged from ROK-1833.
 */

/** The stream + headers the reader needs (an Express request satisfies it). */
export type BoundedBodySource = Readable & ValheimLinkBypassedRequest;

/** Options for {@link readBoundedBody}. */
export interface BoundedBodyOptions {
  /** CONTRACT §7 cap on the DECODED bytes (also the wire cap). */
  maxBytes: number;
  /** Media type the route accepts, e.g. `application/json`. */
  contentType: string;
}

/** 413 `payload_too_large`. */
export const tooLarge = (): PayloadTooLargeException =>
  new PayloadTooLargeException(
    ingestError('payload_too_large', 'body exceeds the cap for this route'),
  );

/** 415 `unsupported_media`. */
export const unsupported = (what: string): UnsupportedMediaTypeException =>
  new UnsupportedMediaTypeException(
    ingestError('unsupported_media', `unsupported ${what}`),
  );

const badGzip = (): BadRequestException =>
  new BadRequestException(ingestError('bad_gzip', 'body is not valid gzip'));

const VALHEIM_ERRORS: BoundedBodyErrors = { tooLarge, unsupported, badGzip };

/** A request header, joined, trimmed and lower-cased (`''` when absent). */
export function headerOf(src: BoundedBodySource, name: string): string {
  return sharedHeaderOf(src, name);
}

/** 415 unless the (bypassed) media type is `want`. */
export function assertContentType(src: BoundedBodySource, want: string): void {
  assertMediaType(src, want, VALHEIM_ERRORS, src[VALHEIM_LINK_CONTENT_TYPE]);
}

/** 413 when `Content-Length` declares more than `max`. */
export function assertDeclaredLength(
  src: BoundedBodySource,
  max: number,
): void {
  assertSharedDeclaredLength(src, max, VALHEIM_ERRORS);
}

/**
 * Read a request body with the kind's cap on the DECODED bytes (CONTRACT §1,
 * §7). `Content-Length` over the cap → 413 before reading; a streamed body or
 * a gzip inflation that crosses the cap → 413 the moment it does (the rest is
 * never buffered); a corrupt gzip → 400 `bad_gzip`; other encodings or a
 * wrong media type → 415.
 */
export async function readBoundedBody(
  src: BoundedBodySource,
  opts: BoundedBodyOptions,
): Promise<Buffer> {
  return readSharedBoundedBody(src, {
    ...opts,
    errors: VALHEIM_ERRORS,
    rawContentType: src[VALHEIM_LINK_CONTENT_TYPE],
  });
}
