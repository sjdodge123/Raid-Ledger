import { Controller, Get } from '@nestjs/common';
import {
  HUB_SCHEMA_VERSION,
  type HubHealthResponse,
} from '@raid-ledger/contract';

/** Hub health probes (relay-hub scope §3.2). Neither touches a database. */
@Controller('v1/health')
export class HealthController {
  /** `GET /api/v1/health`. `epoch` arrives with RH-2b (ROK-1670). */
  @Get()
  health(): HubHealthResponse {
    return { status: 'ok', schemaVersions: [HUB_SCHEMA_VERSION] };
  }

  /** `GET /api/v1/health/live`: the process is up. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
