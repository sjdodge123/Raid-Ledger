import { createHash } from 'node:crypto';
import type { ValheimContainer } from '@raid-ledger/contract';

/**
 * ROK-1853 D7: the opaque per-chest key the browser sees — base64url of the
 * first 16 bytes of sha256(`worldUid|prefab|x|y|z|creatorPlayerId`). Stable
 * across 10-minute re-imports (row ids are not), reveals neither row order
 * nor the creator, and distinct for two creators' chests at one spot.
 */
export function containerPublicKey(
  worldUid: string,
  c: Pick<ValheimContainer, 'prefab' | 'x' | 'y' | 'z' | 'creatorPlayerId'>,
): string {
  const identity = `${worldUid}|${c.prefab}|${c.x}|${c.y}|${c.z}|${c.creatorPlayerId}`;
  return createHash('sha256')
    .update(identity)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}
