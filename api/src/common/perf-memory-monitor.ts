import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { isPerfEnabled, perfLog } from './perf-logger';

/** Default interval between memory snapshots (5 minutes). */
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodic heap/RSS memory snapshot service (ROK-563).
 * Emits [PERF] HEAP lines every 5 minutes when DEBUG=true.
 * Zero overhead when disabled — interval is never started.
 *
 * ROK-609: Also monitors RSS against MEMORY_RESTART_THRESHOLD_MB.
 * When RSS exceeds the threshold, the process exits gracefully so
 * the container runtime (Watchtower/Docker) can restart it.
 * The RSS check runs unconditionally (not gated behind DEBUG).
 */
@Injectable()
export class PerfMemoryMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PerfMemoryMonitor.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly rssThresholdBytes: number | null;

  constructor() {
    const thresholdMB = parseInt(
      process.env.MEMORY_RESTART_THRESHOLD_MB ?? '',
      10,
    );
    this.rssThresholdBytes =
      !isNaN(thresholdMB) && thresholdMB > 0 ? thresholdMB * 1024 * 1024 : null;
  }

  onModuleInit(): void {
    if (this.rssThresholdBytes) {
      this.logger.log(
        `RSS restart guard active — threshold: ${this.rssThresholdBytes / 1024 / 1024}MB`,
      );
    }

    // Always start the interval when either perf logging or the RSS guard is active.
    if (!isPerfEnabled() && !this.rssThresholdBytes) return;

    this.logger.debug('Starting memory monitor (5-minute interval)');
    this.emitSnapshot(); // Initial snapshot on boot
    this.intervalRef = setInterval(
      () => this.emitSnapshot(),
      SNAPSHOT_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private emitSnapshot(): void {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    if (isPerfEnabled()) {
      perfLog('HEAP', 'snapshot', 0, {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB,
        externalMB: Math.round(mem.external / 1024 / 1024),
        arrayBuffersMB: Math.round(mem.arrayBuffers / 1024 / 1024),
      });
    }

    // RSS restart guard — exit gracefully so container runtime restarts us.
    if (this.rssThresholdBytes && mem.rss > this.rssThresholdBytes) {
      this.logger.warn(
        `RSS ${rssMB}MB exceeds threshold ${this.rssThresholdBytes / 1024 / 1024}MB — triggering graceful restart`,
      );
      process.exit(0);
    }
  }
}
