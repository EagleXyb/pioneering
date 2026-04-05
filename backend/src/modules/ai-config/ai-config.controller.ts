import { Controller, Get, Post, Put, Delete, Body, Param, Query, ConsoleLogger } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';
import { CreateAiConfigDto, UpdateAiConfigDto, TestConnectionDto } from './dto/ai-config.dto';

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
}