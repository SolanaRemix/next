import { Module } from '@nestjs/common';
import { PerpetualsModule } from './perpetuals/perpetuals.module.js';

@Module({
  imports: [PerpetualsModule],
})
export class AppModule {}
