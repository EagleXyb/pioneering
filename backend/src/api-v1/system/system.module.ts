import { Module } from '@nestjs/common';
import { SystemController, HealthController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  controllers: [SystemController, HealthController],
  providers: [SystemService],
})
export class SystemModule {}