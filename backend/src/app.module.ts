import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './modules/profile/profile.module';
import { AiConfigModule } from './modules/ai-config/ai-config.module';

@Module({
  imports: [PrismaModule, ProfileModule, AiConfigModule],
})
export class AppModule {}
