import type {
  ValheimBinaryRef,
  ValheimLinkMessage,
} from '@raid-ledger/contract';
import type {
  NewValheimLinkSnapshot,
  ValheimLinkBlobRefRow,
} from '../../../../drizzle/schema';

/**
 * CONTRACT §1 latest-wins key, minus the server (that is the
 * `pelican_server_id` column of `valheim_link_snapshots_key_uq`):
 * character → steamId:playerId; map → steamId:playerId:worldUid;
 * items → gameVersion.
 */
export function valheimSnapshotKey(msg: ValheimLinkMessage): string {
  if (msg.kind === 'items' || msg.kind === 'recipes') return msg.gameVersion;
  const { steamId, playerId, worldUid } = msg.character;
  return msg.kind === 'map'
    ? `${steamId}:${playerId}:${worldUid}`
    : `${steamId}:${playerId}`;
}

const toRef = (
  ref: ValheimBinaryRef,
  role: ValheimLinkBlobRefRow['role'],
): ValheimLinkBlobRefRow => ({
  sha256: ref.sha256,
  byteLength: ref.byteLength,
  width: ref.width,
  height: ref.height,
  role,
});

/** Every binary the message references, one entry per sha256. */
export function valheimBlobRefs(
  msg: ValheimLinkMessage,
): ValheimLinkBlobRefRow[] {
  const refs: ValheimLinkBlobRefRow[] = [];
  if (msg.kind === 'map' && msg.baseMap)
    refs.push(toRef(msg.baseMap, 'baseMap'));
  if (msg.kind === 'recipes' && msg.atlas) refs.push(toRef(msg.atlas, 'atlas'));
  if (msg.kind === 'items') {
    if (msg.atlas) refs.push(toRef(msg.atlas, 'atlas'));
    for (const item of msg.items) {
      if (item.icon?.kind === 'file' && item.icon.blob) {
        refs.push(toRef(item.icon.blob, 'fileIcon'));
      }
    }
  }
  const seen = new Set<string>();
  return refs.filter((r) => !seen.has(r.sha256) && !!seen.add(r.sha256));
}

/** The `valheim_link_snapshots` row for an accepted message (status pending). */
export function valheimSnapshotRow(
  pelicanServerId: number,
  msg: ValheimLinkMessage,
): NewValheimLinkSnapshot {
  const who =
    msg.kind === 'items' || msg.kind === 'recipes' ? null : msg.character;
  return {
    pelicanServerId,
    kind: msg.kind,
    snapshotKey: valheimSnapshotKey(msg),
    steamId: who?.steamId ?? null,
    playerId: who?.playerId ?? null,
    worldUid: who?.worldUid ?? null,
    gameVersion: msg.gameVersion,
    modVersion: msg.modVersion,
    capturedAt: new Date(msg.capturedAt),
    payload: msg,
    blobRefs: valheimBlobRefs(msg),
    status: 'pending',
    statusDetail: null,
  };
}
