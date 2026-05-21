import { Controller, Get, Post, Put, Delete, Patch, Body, Param, ConsoleLogger } from '@nestjs/common';
import { ChatConversationService } from './chat-conversation.service';
import { CreateConversationDto, UpdateConversationDto, CreateMessageDto, UpdateMessageDto } from './dto/chat-conversation.dto';

@Controller('api/chat')
export class ChatConversationController {
  private readonly logger = new ConsoleLogger(ChatConversationController.name);

  constructor(private readonly chatService: ChatConversationService) {}

  // ===== 会话 =====

  @Get('conversations')
  async getConversations() {
    this.logger.log('getConversations');
    return this.chatService.findAllConversations();
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    return this.chatService.findConversationById(+id);
  }

  @Post('conversations')
  async createConversation(@Body() dto: CreateConversationDto) {
    this.logger.log(`createConversation: title=${dto.title}, model=${dto.model}`);
    return this.chatService.createConversation(dto);
  }

  @Patch('conversations/:id')
  async updateConversation(@Param('id') id: string, @Body() dto: UpdateConversationDto) {
    return this.chatService.updateConversation(+id, dto);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string) {
    return this.chatService.deleteConversation(+id);
  }

  // ===== 消息 =====

  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string) {
    return this.chatService.findMessagesByConversation(+id);
  }

  @Post('conversations/:id/messages')
  async createMessage(@Param('id') id: string, @Body() dto: CreateMessageDto) {
    return this.chatService.createMessage(+id, dto);
  }

  @Put('conversations/:conversationId/messages/:msgId')
  async updateMessage(
    @Param('conversationId') conversationId: string,
    @Param('msgId') msgId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.chatService.updateMessage(+msgId, dto);
  }

  @Delete('conversations/:conversationId/messages/:msgId')
  async deleteMessage(
    @Param('conversationId') conversationId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.chatService.deleteMessage(+msgId);
  }
}
