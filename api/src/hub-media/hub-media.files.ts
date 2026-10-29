import { rename, rm, writeFile } from 'node:fs/promises';
import { mediaFilePath, mediaTempPath } from './hub-media.paths';

/** Write one rendition tmp → rename, so a reader never sees a partial file. */
async function writeAtomic(
  final: string,
  guildId: number,
  buf: Buffer,
): Promise<void> {
  const tmp = await mediaTempPath(guildId);
  try {
    await writeFile(tmp, buf);
    await rename(tmp, final);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Store both renditions of a picture (spec D3 — before the row insert). */
export async function writeMediaFiles(
  guildId: number,
  storageName: string,
  full: Buffer,
  thumb: Buffer,
): Promise<void> {
  try {
    await writeAtomic(
      mediaFilePath(guildId, storageName, 'full'),
      guildId,
      full,
    );
    await writeAtomic(
      mediaFilePath(guildId, storageName, 'thumb'),
      guildId,
      thumb,
    );
  } catch (err) {
    await unlinkMediaFiles(guildId, storageName);
    throw err;
  }
}

/** Remove both renditions (no error when already gone). */
export async function unlinkMediaFiles(
  guildId: number,
  storageName: string,
): Promise<void> {
  await rm(mediaFilePath(guildId, storageName, 'full'), { force: true });
  await rm(mediaFilePath(guildId, storageName, 'thumb'), { force: true });
}
