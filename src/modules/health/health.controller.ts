import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('/health/liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('/health/readiness')
  async readiness() {
    return this.healthService.getReadiness();
  }
}


