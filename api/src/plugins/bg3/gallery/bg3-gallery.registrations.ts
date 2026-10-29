import { Injectable, OnModuleInit } from '@nestjs/common';
import { registerHubIngestSource } from '../../../hub-media/hub-media-ingest-sources';
import { HubMediaSourceGateRegistry } from '../../../hub-media/hub-media.source-gates';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import { Bg3ReadRepository } from '../read/bg3-read.repository';

/**
 * ROK-1959 — the bg3 plugin's Gallery behaviours: the `bg3-save.gallery`
 * ingest source (D-12) and the `bg3-save` media gate (D-5), which hides save
 * pictures on a hub hiding spoilers. The registry fails closed, so they are
 * also hidden while `bg3` is off. Kept apart from subject/decorator
 * registrations so the ownership scanner counts each once.
 */
@Injectable()
export class Bg3GalleryRegistrations implements OnModuleInit {
  constructor(
    private readonly gates: HubMediaSourceGateRegistry,
    private readonly read: Bg3ReadRepository,
  ) {}

  onModuleInit(): void {
    registerHubIngestSource(BG3_PLUGIN_ID, 'bg3-save.gallery');
    this.gates.register(BG3_PLUGIN_ID, 'bg3-save', (guildId) =>
      this.hidesSpoilers(guildId),
    );
  }

  /** Exposed for specs: the hub's spoiler toggle. */
  async hidesSpoilers(guildId: number): Promise<boolean> {
    return (await this.read.settings(guildId)).hideLocationAndScreenshots;
  }
}
