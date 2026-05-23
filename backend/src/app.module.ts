import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ApiV1Module } from './api-v1/api-v1.module';

@Module({
  imports: [PrismaModule, ApiV1Module],
})
export class AppModule {}
