import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators.js';
import { SkipGeographicAccess } from '../geo/geographic-access.guard.js';
import { HealthService } from './health.service.js';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @SkipGeographicAccess()
  live() {
    return this.health.live();
  }

  @Get('ready')
  @SkipGeographicAccess()
  ready() {
    return this.health.ready();
  }
}
