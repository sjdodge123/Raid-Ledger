import { Module } from '@nestjs/common';
import { CspReportController } from './csp-report.controller';

@Module({
  controllers: [CspReportController],
})
export class CspReportModule {}
