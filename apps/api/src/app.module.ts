import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './throttling/redis-throttler.storage.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { PerpetualsModule } from './perpetuals/perpetuals.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisThrottlerModule } from './throttling/redis-throttler.module.js';
import { SwapsModule } from './swaps/swaps.module.js';
import { validateEnvironment } from './config/environment.js';
import { GeographicAccessGuard } from './geo/geographic-access.guard.js';
import { SolanaMarketModule } from './solana-market/solana-market.module.js';
import { FinancialControlsModule } from './financial-controls/financial-controls.module.js';
import { HealthModule } from './health/health.module.js';
import { PortfolioPricesModule } from './portfolio-prices/portfolio-prices.module.js';
import { AuditModule } from './audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),
    PrismaModule,
    AuthModule,
    PerpetualsModule,
    SolanaMarketModule,
    FinancialControlsModule,
    HealthModule,
    PortfolioPricesModule,
    SwapsModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: GeographicAccessGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
