import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { stopTelemetry } from './telemetry.js';
import { stopSentry } from './sentry.js';

class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([stopTelemetry(), stopSentry()]);
  }
}

@Module({
  providers: [TelemetryShutdown],
})
export class ObservabilityModule {}
