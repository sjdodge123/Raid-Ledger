import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { IgdbService } from './igdb.service';
import { QueueHealthService } from '../queue/queue-health.service';

export const IGDB_SYNC_QUEUE = 'igdb-sync';

export interface IgdbSyncJobData {
  trigger: 'scheduled' | 'config-update' | 'manual';
}

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

  async process(
    job: Job<IgdbSyncJobData>,
  ): Promise<{ refreshed: number; discovered: number }> {
    this.logger.log(`Starting IGDB sync (trigger: ${job.data.trigger})`);
    await job.updateProgress(0);

    const result = await this.igdbService.syncAllGames();

    await job.updateProgress(100);
    this.logger.log(
      `IGDB sync complete: refreshed ${result.refreshed}, discovered ${result.discovered}`,
    );

    return result;
  }
}
