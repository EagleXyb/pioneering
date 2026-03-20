import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './modules/profile/profile.module';

@Module({
  imports: [PrismaModule, ProfileModule],
})
export class AppModule {}
