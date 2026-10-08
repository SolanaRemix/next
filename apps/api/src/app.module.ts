import { Module } from '@nestjs/common';
import { PerpetualsModule } from './perpetuals/perpetuals.module.js';
import { SwapsModule } from './swaps/swaps.module.js';

@Module({
  imports: [PerpetualsModule, SwapsModule],
})
export class AppModule {}
