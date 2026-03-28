import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { IgdbService } from './igdb.service';
import { QueueHealthService } from '../queue/queue-health.service';
import { IGDB_SYNC_QUEUE, IgdbSyncJobData } from './igdb-sync.constants';

@Processor(IGDB_SYNC_QUEUE)
export class IgdbSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(IgdbSyncProcessor.name);

  constructor(
    private readonly igdbService: IgdbService,
    @InjectQueue(IGDB_SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.syncQueue);
  }

  async process(job: Job<IgdbSyncJobData>) {
    if (job.data.trigger === 'reenrich-game') {
      return this.handleReenrich(job);
    }
    return this.handleFullSync(job);
  }

  /** Handle a single-game re-enrichment job. */
  private async handleReenrich(job: Job<IgdbSyncJobData>) {
    const { gameId } = job.data as { trigger: 'reenrich-game'; gameId: number };
    this.logger.log(`Re-enriching game ${gameId}`);
    await this.igdbService.reEnrichSingleGame(gameId);
  }

  /** Handle a full IGDB sync job. */
  private async handleFullSync(job: Job<IgdbSyncJobData>) {
    this.logger.log(`Starting IGDB sync (trigger: ${job.data.trigger})`);
    await job.updateProgress(0);
    const result = await this.igdbService.syncAllGames();
    await job.updateProgress(100);
    this.logger.log(
      `IGDB sync complete: refreshed ${result.refreshed}, discovered ${result.discovered}, backfilled ${result.backfilled}`,
    );
    return result;
  }
}
