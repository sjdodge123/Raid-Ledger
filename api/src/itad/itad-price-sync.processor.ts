/**
 * BullMQ processor for on-demand ITAD price sync (ROK-1047).
 * Fetches pricing for a single missing game when `/games/pricing/batch`
 * encounters a cache miss. Per-game dedupe is enforced at enqueue time
 * via `jobId: itad-price-${gameId}` (BullMQ rejects duplicate jobIds
 * while waiting/active). The wrapper try/catch keeps a single ITAD
 * failure from poisoning the queue — BullMQ retry would be overkill
 * for opportunistic warm-the-cache work.
 */
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ItadPriceSyncService } from './itad-price-sync.service';
import { QueueHealthService } from '../queue/queue-health.service';
import {
  ITAD_PRICE_SYNC_QUEUE,
  type ItadPriceSyncJobData,
} from './itad-price-sync.constants';

@Processor(ITAD_PRICE_SYNC_QUEUE)
export class ItadPriceSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ItadPriceSyncProcessor.name);

  constructor(
    private readonly itadPriceSyncService: ItadPriceSyncService,
    @InjectQueue(ITAD_PRICE_SYNC_QUEUE) private readonly queue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.queue);
  }

  async process(job: Job<ItadPriceSyncJobData>): Promise<void> {
    const { gameId } = job.data;
    try {
      await this.itadPriceSyncService.syncSpecificGames([gameId]);
    } catch (err) {
      this.logger.warn(
        `ITAD on-demand sync failed for game ${gameId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
