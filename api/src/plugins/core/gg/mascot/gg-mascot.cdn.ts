import {
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertMascotAsset,
  mascotMaxBytes,
  type MascotAssetKind,
  type MascotExt,
} from './gg-mascot.storage';

/** A downloaded, size-capped, sniffed mascot asset. */
export interface MascotAsset {
  buf: Buffer;
  ext: MascotExt;
}

const DOWNLOAD_TIMEOUT_MS = 10_000;

/**
 * ROK-2187 — downloads one Discord CDN asset (no redirects, 10 s timeout),
 * refuses an oversize `content-length` before reading, then caps + sniffs
 * the bytes (422 on oversize / wrong type, 502 on a CDN failure).
 */
export async function downloadMascotAsset(
  url: string,
  kind: MascotAssetKind,
): Promise<MascotAsset> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new BadGatewayException(
      `Could not reach the Discord CDN for the mascot ${kind}`,
    );
  }
  if (!res.ok)
    throw new BadGatewayException(
      `Discord CDN answered ${res.status} for the mascot ${kind}`,
    );
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > mascotMaxBytes(kind)) {
    throw new UnprocessableEntityException(
      `Mascot ${kind} is over ${mascotMaxBytes(kind)} bytes`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, ext: assertMascotAsset(buf, kind) };
}
