import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { stopTelemetry } from './telemetry.js';

class TelemetryShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return stopTelemetry();
  }
}

@Module({
  providers: [TelemetryShutdown],
})
export class ObservabilityModule {}
