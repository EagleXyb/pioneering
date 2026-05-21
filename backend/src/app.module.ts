import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './modules/profile/profile.module';
import { AiConfigModule } from './modules/ai-config/ai-config.module';
import { GlobalPromptModule } from './modules/global-prompt/global-prompt.module';
import { ChatConversationModule } from './modules/chat-conversation/chat-conversation.module';

@Module({
  imports: [PrismaModule, ProfileModule, AiConfigModule, GlobalPromptModule, ChatConversationModule],
})
export class AppModule {}
