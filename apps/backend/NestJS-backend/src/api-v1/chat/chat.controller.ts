import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateSessionDto,
  UpdateSessionDto,
  ChatCompletionDto,
  StopGenerationDto,
  FeedbackDto,
  EditMessageDto,
  RegenerateDto,
  QueryMessagesDto,
  QuerySessionsDto,
} from './dto/chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ========== 会话 ==========

  @Get('sessions')
  listSessions(
    @CurrentUser('sub') userId: string,
    @Query() query: QuerySessionsDto,
  ) {
    return this.chatService.listSessions(userId, query);
  }

  @Post('sessions')
  createSession(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateSessionDto,
  ) {
    return this.chatService.createSession(userId, dto);
  }

  @Get('sessions/:sessionId')
  getSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.chatService.getSession(userId, sessionId);
  }

  @Put('sessions/:sessionId')
  updateSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.chatService.updateSession(userId, sessionId, dto);
  }

  @Delete('sessions/:sessionId')
  deleteSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Query('archive') archive?: string,
  ) {
    const shouldArchive = archive === undefined ? undefined : archive === 'true';
    return this.chatService.deleteSession(userId, sessionId, shouldArchive);
  }

  // ========== 消息 ==========

  @Get('sessions/:sessionId/messages')
  getMessages(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Query() query: QueryMessagesDto,
  ) {
    return this.chatService.getMessages(userId, sessionId, query);
  }

  @Put('sessions/:sessionId/messages/:messageId')
  editMessage(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(userId, sessionId, messageId, dto);
  }

  // ========== 对话补全 ==========

  @Post('completions')
  async chatCompletion(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChatCompletionDto,
    @Res() res: Response,
  ) {
    if (dto.stream === false) {
      const result = await this.chatService.chatCompletion(userId, dto);
      return res.json(result);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    return this.chatService.streamChatCompletion(userId, dto, res);
  }

  @Post('completions/stop')
  stopGeneration(
    @CurrentUser('sub') userId: string,
    @Body() dto: StopGenerationDto,
  ) {
    return this.chatService.stopGeneration(userId, dto.sessionId, dto.messageId);
  }

  // ========== 反馈 ==========

  @Post('messages/:messageId/feedback')
  setFeedback(
    @CurrentUser('sub') userId: string,
    @Param('messageId') messageId: string,
    @Body() dto: FeedbackDto,
  ) {
    return this.chatService.setFeedback(userId, messageId, dto.feedback);
  }

  // ========== 重新生成 ==========

  @Post('messages/:messageId/regenerate')
  regenerate(
    @CurrentUser('sub') userId: string,
    @Param('messageId') messageId: string,
    @Body() dto: RegenerateDto,
  ) {
    return this.chatService.regenerate(userId, messageId, dto);
  }
}