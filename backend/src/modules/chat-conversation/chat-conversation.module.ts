import { Module } from '@nestjs/common';
import { ChatConversationService } from './chat-conversation.service';
import { ChatConversationController } from './chat-conversation.controller';

@Module({
  controllers: [ChatConversationController],
  providers: [ChatConversationService],
  exports: [ChatConversationService],
})
export class ChatConversationModule {}
