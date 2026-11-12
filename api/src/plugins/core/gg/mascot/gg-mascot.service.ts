import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GgMascotSchema,
  type GgMascot,
  type GgMascotOptionsDto,
  type GgMascotSelectDto,
} from '@raid-ledger/contract';
import { SettingsService } from '../../../../settings/settings.service';
import { emojiCdnUrl, soundCdnUrl } from './gg-mascot-discord.source';
import { GgMascotOptionsService } from './gg-mascot-options.service';
import { downloadMascotAsset, type MascotAsset } from './gg-mascot.cdn';
import { readGgMascot, writeGgMascot } from './gg-mascot.settings';
import { mascotFileFromUrl, removeMascotFiles, writeMascotFile } from './gg-mascot.storage';

type EmojiOption = GgMascotOptionsDto['emojis'][number];
type SoundOption = GgMascotOptionsDto['sounds'][number];

interface SoundCopy {
  soundId: string | null;
  soundName: string | null;
  soundUrl: string | null;
  volume: number;
}

const NO_SOUND: SoundCopy = { soundId: null, soundName: null, soundUrl: null, volume: 1 };

/**
 * ROK-2187 — saves the admin's mascot pick: validates the ids against the
 * guild's list (400) and availability (409), COPIES the emoji + sound into
 * `uploads/gg-mascot/`, stores `GG_MASCOT`, and prunes stale copies.
 */
@Injectable()
export class GgMascotService {
  constructor(
    private readonly options: GgMascotOptionsService,
    private readonly settings: SettingsService,
  ) {}

  /** The current mascot, or `null`. */
  current(): Promise<GgMascot | null> {
    return readGgMascot(this.settings);
  }

  /** Applies a selection; `emojiId: null` removes the mascot and its copies. */
  async select(dto: GgMascotSelectDto): Promise<GgMascot | null> {
    if (dto.emojiId === null) {
      await writeGgMascot(this.settings, null);
      await removeMascotFiles(new Set());
      return null;
    }
    const opts = await this.options.getOptions();
    const emoji = findOrThrow(opts.emojis, dto.emojiId, 'emoji');
    const sound = dto.soundId === null ? null : findOrThrow(opts.sounds, dto.soundId, 'sound');
    if (sound && !sound.available) throw new ConflictException('That soundboard sound is unavailable');
    const mascot = GgMascotSchema.parse({ ...(await copyEmoji(emoji)), ...(await copySound(sound)) });
    await writeGgMascot(this.settings, mascot);
    await removeMascotFiles(keptFiles(mascot));
    return mascot;
  }

  /** Streams a guild sound for the picker's ▶ (media-src blocks the CDN). */
  async previewSound(id: string): Promise<MascotAsset> {
    const opts = await this.options.getOptions();
    if (!opts.sounds.some((s) => s.id === id)) throw new NotFoundException('Unknown soundboard sound');
    return downloadMascotAsset(soundCdnUrl(id), 'sound');
  }
}

function findOrThrow<T extends { id: string }>(list: T[], id: string, what: string): T {
  const hit = list.find((o) => o.id === id);
  if (!hit) throw new BadRequestException(`That ${what} is not in this Discord server`);
  return hit;
}

async function copyEmoji(emoji: EmojiOption): Promise<Pick<GgMascot, 'emojiId' | 'emojiName' | 'animated' | 'imageUrl'>> {
  const asset = await downloadMascotAsset(emojiCdnUrl(emoji.id, emoji.animated), 'image');
  const imageUrl = await writeMascotFile(emoji.id, asset.ext, asset.buf);
  return { emojiId: emoji.id, emojiName: emoji.name, animated: emoji.animated, imageUrl };
}

async function copySound(sound: SoundOption | null): Promise<SoundCopy> {
  if (!sound) return NO_SOUND;
  const asset = await downloadMascotAsset(soundCdnUrl(sound.id), 'sound');
  const soundUrl = await writeMascotFile(sound.id, asset.ext, asset.buf);
  return { soundId: sound.id, soundName: sound.name, soundUrl, volume: sound.volume };
}

function keptFiles(mascot: GgMascot): Set<string> {
  const names = [mascotFileFromUrl(mascot.imageUrl), mascotFileFromUrl(mascot.soundUrl)];
  return new Set(names.filter((n): n is string => n !== null));
}
