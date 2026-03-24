import { Module } from '@nestjs/common';
import { GlobalPromptService } from './global-prompt.service';
import { GlobalPromptController } from './global-prompt.controller';

@Module({
  controllers: [GlobalPromptController],
  providers: [GlobalPromptService],
  exports: [GlobalPromptService],
})
export class GlobalPromptModule {}
