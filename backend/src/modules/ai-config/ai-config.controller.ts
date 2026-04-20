import { Controller, Get, Post, Put, Delete, Body, Param, Query, ConsoleLogger, Res, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { AiConfigService } from './ai-config.service';
import { CreateAiConfigDto, UpdateAiConfigDto, TestConnectionDto, ChatStreamDto } from './dto/ai-config.dto';

@Controller('ai-config')
export class AiConfigController {
  private readonly logger = new ConsoleLogger(AiConfigController.name);

  constructor(private readonly aiConfigService: AiConfigService) {}

  @Post('test')
  testConnection(@Body() testConnectionDto: TestConnectionDto) {
    this.logger.log(`testConnection: ${testConnectionDto.provider}/${testConnectionDto.model}`);
    return this.aiConfigService.testConnection(
      testConnectionDto.apiKey,
      testConnectionDto.provider,
      testConnectionDto.model,
    );
  }

  @Post('save')
  saveConfig(@Body() createAiConfigDto: CreateAiConfigDto) {
    this.logger.log(`saveConfig: provider=${createAiConfigDto.provider}, model=${createAiConfigDto.model}`);
    return this.aiConfigService.saveConfig(createAiConfigDto);
  }

  @Post()
  create(@Body() createAiConfigDto: CreateAiConfigDto) {
    return this.aiConfigService.upsert(createAiConfigDto);
  }

  @Get()
  findAll() {
    return this.aiConfigService.findAll();
  }

  @Get('latest')
  findLatest() {
    return this.aiConfigService.findLatest();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.aiConfigService.findOne(+id);
  }

  @Get('provider/:provider/model/:model')
  findByProviderModel(
    @Param('provider') provider: string,
    @Param('model') model: string,
  ) {
    return this.aiConfigService.findByProviderModel(provider, model);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateAiConfigDto: UpdateAiConfigDto,
  ) {
    return this.aiConfigService.update(+id, updateAiConfigDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.aiConfigService.remove(+id);
  }

  @Post('chat/stream')
  async chatStream(@Body() chatStreamDto: ChatStreamDto, @Res() res: Response) {
    this.logger.log(`chatStream: messages count=${chatStreamDto.messages.length}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    await this.aiConfigService.streamChat(chatStreamDto.messages, res);
  }
}