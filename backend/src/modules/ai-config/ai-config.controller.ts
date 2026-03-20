import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';
import { CreateAiConfigDto, UpdateAiConfigDto } from './dto/ai-config.dto';

@Controller('ai-config')
export class AiConfigController {
  constructor(private readonly aiConfigService: AiConfigService) {}

  @Post()
  create(@Body() createAiConfigDto: CreateAiConfigDto) {
    return this.aiConfigService.upsert(createAiConfigDto);
  }

  @Get()
  findAll() {
    return this.aiConfigService.findAll();
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