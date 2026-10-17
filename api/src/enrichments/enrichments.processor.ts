import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueHealthService } from '../queue/queue-health.service';
import { ENRICHMENT_QUEUE, EnrichmentJobData } from './enrichments.constants';
import { EnrichmentsService } from './enrichments.service';

@Processor(ENRICHMENT_QUEUE)
export class EnrichmentsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EnrichmentsProcessor.name);

  constructor(
    private readonly enrichmentsService: EnrichmentsService,
    @InjectQueue(ENRICHMENT_QUEUE) private readonly enrichmentQueue: Queue,
    private readonly queueHealth: QueueHealthService,
  ) {
    super();
  }

  onModuleInit() {
    this.queueHealth.register(this.enrichmentQueue);
  }

  async process(job: Job<EnrichmentJobData>): Promise<void> {
    const data = job.data;

    if ('characterId' in data) {
      const { characterId, enricherKey, gameSlug } = data;
      this.logger.debug(
        `Processing character enrichment: ${enricherKey} for ${characterId}`,
      );
      await this.enrichmentsService.runCharacterEnrichment(
        characterId,
        enricherKey,
        gameSlug,
      );
    } else if ('eventId' in data) {
      const { eventId, enricherKey, gameSlug } = data;
      this.logger.debug(
        `Processing event enrichment: ${enricherKey} for ${eventId}`,
      );
      await this.enrichmentsService.runEventEnrichment(
        eventId,
        enricherKey,
        gameSlug,
      );
    } else {
      this.logger.warn(`Unknown enrichment job data: ${JSON.stringify(data)}`);
    }
  }
}
