import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { isPerfEnabled, perfLog } from './perf-logger';

/**
 * Periodic heap/RSS memory snapshot service (ROK-563).
 * Emits [PERF] HEAP lines every 5 minutes when DEBUG=true.
 * Zero overhead when disabled — interval is never started.
 */
@Injectable()
export class PerfMemoryMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PerfMemoryMonitor.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  onModuleInit(): void {
    if (!isPerfEnabled()) return;

    this.logger.debug('Starting memory monitor (5-minute interval)');
    this.emitSnapshot(); // Initial snapshot on boot
    this.intervalRef = setInterval(() => this.emitSnapshot(), 5 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private emitSnapshot(): void {
    const mem = process.memoryUsage();
    perfLog('HEAP', 'snapshot', 0, {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
    });
  }
}
