import { Global, Module } from '@nestjs/common';
import { HUB_CONFIG, loadHubConfig } from './hub-config';

@Global()
@Module({
  providers: [
    { provide: HUB_CONFIG, useFactory: () => loadHubConfig(process.env) },
  ],
  exports: [HUB_CONFIG],
})
export class HubConfigModule {}
